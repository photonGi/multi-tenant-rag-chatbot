/**
 * The meeting confirmation mail: its variables, its default, and the
 * substitution the preview runs.
 *
 * This module is the single authority on what `{{...}}` means. The editor's
 * variable list, the preview pane and the seeded default all read from here, so
 * there is no second list to fall out of step with the first — the failure mode
 * being an owner who inserts a variable the sender has never heard of and only
 * finds out when a lead receives `{{meeting_time}}` in their inbox.
 *
 * Pure and dependency-free on purpose: it renders in the browser for the
 * preview, and the same values are what the booking workflow substitutes.
 */

export const MEETING_CONFIRMATION_KEY = 'meeting_confirmation'

export interface TemplateVariable {
  /** Written as {{token}} in the subject or body. */
  token: string
  label: string
  /** Stands in for the real value in the preview. */
  sample: string
}

/**
 * Everything the booking workflow can fill in.
 *
 * Adding to this list is safe; renaming a token is not — an existing template
 * still holding the old one would render it literally into a real email.
 */
export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  { token: 'lead_name', label: 'Lead name', sample: 'Jordan Ellis' },
  { token: 'lead_email', label: 'Lead email', sample: 'jordan@example.com' },
  { token: 'meeting_date', label: 'Meeting date', sample: 'Thursday, 14 August 2025' },
  { token: 'meeting_time', label: 'Meeting time', sample: '3:00 PM (Europe/London)' },
  { token: 'meet_link', label: 'Google Meet link', sample: 'https://meet.google.com/abc-defg-hij' },
  { token: 'company_name', label: 'Workspace name', sample: 'Acme Corporation' },
] as const

export type TemplateContext = Record<string, string>

/** The dummy values behind the preview pane. */
export function sampleContext(companyName?: string): TemplateContext {
  const context: TemplateContext = {}

  for (const variable of TEMPLATE_VARIABLES) {
    context[variable.token] = variable.sample
  }

  // The one value the console actually knows, so the preview reads as this
  // workspace's mail rather than a generic sample.
  if (companyName?.trim()) context.company_name = companyName.trim()

  return context
}

/**
 * Matches `{{ token }}` with any amount of inner whitespace.
 *
 * The token class is deliberately narrow (word characters only). A greedy
 * `.+?` would happily treat a stretch of HTML between two braces as a variable
 * name and delete it from the output.
 */
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g

/**
 * Substitutes variables into a subject or body.
 *
 * An unknown token is left exactly as written rather than replaced with an
 * empty string. Silently deleting it would make a typo invisible right up until
 * a lead receives a sentence with a hole in it; leaving `{{meting_time}}` in the
 * preview puts the mistake in front of the person who can fix it.
 */
export function renderTemplate(source: string, context: TemplateContext): string {
  return source.replace(PLACEHOLDER, (whole, token: string) =>
    Object.prototype.hasOwnProperty.call(context, token) ? context[token] : whole,
  )
}

/** Every `{{token}}` in a string that this app does not recognise. */
export function unknownVariables(source: string): string[] {
  const known = new Set(TEMPLATE_VARIABLES.map((variable) => variable.token))
  const found = new Set<string>()

  for (const match of source.matchAll(PLACEHOLDER)) {
    if (!known.has(match[1])) found.add(match[1])
  }

  return [...found]
}

export interface EmailTemplate {
  subject: string
  body_html: string
}

/**
 * The template a workspace starts with, so this page is never a blank box.
 *
 * Written as inline-styled table-free HTML with a system font stack, because
 * that is the subset email clients agree on — Outlook ignores `<style>` blocks
 * in the head, Gmail strips them from the body, and neither supports flexbox.
 * The result is plain, which is the correct look for a confirmation anyway.
 *
 * `{{meet_link}}` is deliberately in its own paragraph: an in-person booking
 * has no link, and this way the workflow can drop the whole line without
 * leaving a dangling "Join here:" behind.
 */
export const DEFAULT_MEETING_CONFIRMATION: EmailTemplate = {
  subject: 'Your meeting with {{company_name}} is confirmed',
  body_html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #18181b;">
  <p>Hi {{lead_name}},</p>

  <p>Your meeting with {{company_name}} is confirmed. Here are the details:</p>

  <p style="padding: 16px; background: #fafafa; border-left: 3px solid #f59e0b;">
    <strong>Date</strong><br />{{meeting_date}}<br /><br />
    <strong>Time</strong><br />{{meeting_time}}
  </p>

  <p><a href="{{meet_link}}" style="color: #18181b;">Join the meeting</a></p>

  <p>If you need to reschedule, just reply to this email and we will sort it out.</p>

  <p>See you then,<br />{{company_name}}</p>
</div>`,
}
