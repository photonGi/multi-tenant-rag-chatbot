/**
 * Widget appearance.
 *
 * Held server-side and delivered by /api/widget/config rather than read from
 * the snippet's data attributes. That is the difference between a customer
 * restyling their widget from your dashboard and a customer filing a ticket
 * with their own dev team to edit and redeploy a script tag.
 *
 * Every value here is written by a tenant and ends up inside CSS, HTML or a
 * URL on a third party's page, so `resolveTheme` is a trust boundary, not a
 * convenience: it is the only way a theme should ever be read.
 */

export interface WidgetTheme {
  /** Launcher and accent colour. Always `#rrggbb`, lowercase. */
  accent: string
  /** Text/icon colour that stays legible on `accent`. Derived, never stored. */
  accentForeground: string
  /**
   * Panel background. Everything neutral in the chat — bubbles, borders, muted
   * text — is derived from this and its foreground, so a dark value produces a
   * coherent dark panel rather than dark-on-light wreckage.
   */
  surface: string
  /**
   * Explicit text colour, or null to derive a legible one from `surface`.
   * Auto is the safe default; an override is for brands that need a specific
   * ink and accept responsibility for the contrast.
   */
  text: string | null
  /** The text colour actually used — `text` when set, derived otherwise. */
  surfaceForeground: string
  position: 'right' | 'left'
  sideOffset: number
  bottomOffset: number
  title: string
  subtitle: string
  greeting: string
  /** Optional pill beside the bubble ("Ask us anything"). */
  launcherLabel: string | null
  starters: string[]
  showBranding: boolean
  /** Seconds before the panel opens itself, or null to stay shut. */
  autoOpenAfter: number | null
}

export const DEFAULT_THEME: WidgetTheme = {
  accent: '#18181b',
  accentForeground: '#ffffff',
  surface: '#ffffff',
  text: null,
  surfaceForeground: '#18181b',
  position: 'right',
  sideOffset: 20,
  bottomOffset: 20,
  title: 'Assistant',
  subtitle: 'Ask about anything on this site',
  greeting: 'Hi! Ask me anything about this site and I will answer from its documents.',
  launcherLabel: null,
  starters: ['What can you help me with?', 'Summarise the main points'],
  showBranding: true,
  autoOpenAfter: null,
}

const HEX_COLOR = /^#[0-9a-f]{6}$/

/**
 * Strict, and strict on purpose. This value is interpolated into a stylesheet
 * inside the host page's DOM; accepting `red; } body { display:none } .x {`
 * would hand every tenant a defacement primitive against their own customers'
 * sites. Three-digit hex is expanded rather than rejected because colour
 * pickers and hand-typed values both produce it.
 */
export function sanitizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim().toLowerCase()
  const expanded = /^#[0-9a-f]{3}$/.test(trimmed)
    ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
    : trimmed

  return HEX_COLOR.test(expanded) ? expanded : fallback
}

/** The dark foreground. Not pure black — it matches the ink scale. */
const DARK_FOREGROUND = '#18181b'
const LIGHT_FOREGROUND = '#ffffff'

/**
 * The luminance at which dark and light text contrast equally against the
 * accent, so either side of it is the better choice.
 *
 * Solving `1.05 / (L + 0.05) = (L + 0.05) / (L_dark + 0.05)` for
 * L_dark ≈ 0.0074 (#18181b) gives L ≈ 0.196. Guessing a round 0.5 here is the
 * classic way to end up with white text on an amber launcher — amber sits at
 * L ≈ 0.44, which reads as "bright" but is well past the crossover.
 */
const CONTRAST_CROSSOVER = 0.196

/**
 * Relative luminance per WCAG, used to pick a foreground that stays readable on
 * whatever accent the tenant chose.
 */
export function readableForeground(hex: string): string {
  return relativeLuminance(hex) > CONTRAST_CROSSOVER
    ? DARK_FOREGROUND
    : LIGHT_FOREGROUND
}

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const srgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  )
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG AA for normal-size text. */
export const AA_CONTRAST = 4.5

/**
 * Whether the panel's body text will actually be readable.
 *
 * Two ways to fail. A mid-tone background is the awkward one: around 50% grey
 * neither black nor white clears AA, so no automatic choice rescues it. The
 * other is an explicit `text` override the owner picked for brand reasons.
 * Both are limits of the colours, not something code can fix — so the
 * dashboard warns and lets the owner decide rather than silently shipping
 * text nobody can read.
 */
export function hasReadableText(theme: WidgetTheme): boolean {
  return contrastRatio(theme.surfaceForeground, theme.surface) >= AA_CONTRAST
}

/** Linear blend of two `#rrggbb` values. `ratio` is how much of `from` to use. */
export function blendHex(from: string, to: string, ratio: number): string {
  const clamp = Math.min(1, Math.max(0, ratio))
  const channel = (hex: string, offset: number) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16)

  const mixed = [1, 3, 5].map((offset) => {
    const value = Math.round(
      channel(from, offset) * clamp + channel(to, offset) * (1 - clamp),
    )
    return value.toString(16).padStart(2, '0')
  })

  return `#${mixed.join('')}`
}

/**
 * The neutral ramp the panel actually paints with, derived from the chosen
 * surface and its foreground.
 *
 * These keys are Tailwind v4 theme variables. The compiled utilities are all
 * `var(--color-*)` references, so setting these on the panel's root element
 * re-themes everything inside it — including the message list, which is shared
 * with the standalone chat page and needs no changes of its own.
 *
 * Computed in JS rather than with CSS `color-mix()` so the result is a plain
 * hex value: deterministic, unit-testable, and free of any browser-support
 * question on a surface that runs inside other people's sites.
 */
export function derivePalette(theme: WidgetTheme): Record<string, string> {
  const fg = theme.surfaceForeground
  const bg = theme.surface
  const step = (ratio: number) => blendHex(fg, bg, ratio)

  return {
    '--color-surface': bg,
    // The transcript sits fractionally off the panel so bubbles read as raised.
    '--color-canvas': step(0.04),
    '--color-border': step(0.14),
    '--color-ink-50': step(0.04),
    '--color-ink-100': step(0.08),
    '--color-ink-200': step(0.14),
    '--color-ink-300': step(0.26),
    '--color-ink-400': step(0.42),
    '--color-ink-500': step(0.55),
    '--color-ink-600': step(0.68),
    '--color-ink-700': step(0.8),
    '--color-ink-900': fg,
  }
}

function sanitizeText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback

  // Collapse whitespace so a pasted multi-line value cannot break the layout,
  // and strip control characters that would survive JSON round-tripping.
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!clean) return fallback
  return clean.slice(0, maxLength)
}

function sanitizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function resolveTheme(raw: unknown): WidgetTheme {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const accent = sanitizeHexColor(input.accent, DEFAULT_THEME.accent)
  const surface = sanitizeHexColor(input.surface, DEFAULT_THEME.surface)

  // Unset or unparseable both mean "derive it" — an invalid override must not
  // be persisted as though the owner had chosen it.
  const textOverride = sanitizeHexColor(input.text, '') || null

  const starters = Array.isArray(input.starters)
    ? input.starters
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => sanitizeText(entry, '', 80))
        .filter(Boolean)
        .slice(0, 4)
    : DEFAULT_THEME.starters

  const launcherLabel = sanitizeText(input.launcherLabel, '', 32)

  return {
    accent,
    accentForeground: readableForeground(accent),
    surface,
    text: textOverride,
    surfaceForeground: textOverride ?? readableForeground(surface),
    position: input.position === 'left' ? 'left' : 'right',
    sideOffset: sanitizeNumber(input.sideOffset, DEFAULT_THEME.sideOffset, 0, 120),
    bottomOffset: sanitizeNumber(input.bottomOffset, DEFAULT_THEME.bottomOffset, 0, 120),
    title: sanitizeText(input.title, DEFAULT_THEME.title, 40),
    subtitle: sanitizeText(input.subtitle, DEFAULT_THEME.subtitle, 80),
    greeting: sanitizeText(input.greeting, DEFAULT_THEME.greeting, 300),
    launcherLabel: launcherLabel || null,
    starters,
    showBranding: input.showBranding !== false,
    // 0 is a valid "open immediately", so the null check has to be explicit.
    autoOpenAfter:
      input.autoOpenAfter === null || input.autoOpenAfter === undefined
        ? null
        : sanitizeNumber(input.autoOpenAfter, 0, 0, 300),
  }
}

/**
 * What gets written back to the `theme` column.
 *
 * Both foregrounds are excluded because they are computed from their colour on
 * read. Storing them would let a stale copy win over the derived value after
 * someone changes the colour it was derived from.
 */
export function serializeTheme(theme: WidgetTheme): Record<string, unknown> {
  const {
    accentForeground: _accentFg,
    surfaceForeground: _surfaceFg,
    ...stored
  } = theme

  return stored
}
