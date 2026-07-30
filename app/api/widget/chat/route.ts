import type { NextRequest } from 'next/server'

import { describeError } from '@/lib/errors'
import { N8nError } from '@/lib/n8n/client'
import { serverN8nClient } from '@/lib/n8n/server'
import { widgetError, widgetJson, widgetPreflight } from '@/lib/widget/http'
import { clientIp, consume } from '@/lib/widget/rate-limit'
import { readSessionToken, verifyWidgetSession } from '@/lib/widget/session'
import { authorizeSession, recordSiteSeen } from '@/lib/widget/site'

/**
 * The widget's chat endpoint — and the reason the workspace key never has to
 * leave the server.
 *
 * The public chat link at /chat/[key] posts to n8n straight from the browser,
 * which is only tolerable because that key is handed to named people. A widget
 * key sits in public HTML, so the same design would hand every visitor a
 * credential that also authorises document ingest. Here the browser sends a
 * signed session instead; this route resolves it to a workspace and calls n8n
 * itself with the real key.
 */

export const dynamic = 'force-dynamic'

/** Per visitor. A human asks a handful of questions a minute, not thirty. */
const PER_VISITOR_PER_MINUTE = 12
/** Per site, across all visitors — the backstop against one key being farmed. */
const PER_SITE_PER_MINUTE = 240

const MAX_QUESTION_LENGTH = 2000

export function OPTIONS(request: NextRequest) {
  return widgetPreflight(request)
}

export async function POST(request: NextRequest) {
  // The panel is served from this origin, so this call is same-origin and the
  // header is ours. It is echoed only to keep a headless caller's CORS honest.
  const origin = request.headers.get('origin')

  const session = await verifyWidgetSession(readSessionToken(request.headers))
  if (!session) {
    // 401 rather than 403: the token is missing or has aged out, and the client
    // knows how to recover from this one by asking the parent for a new config.
    return widgetError('invalid_request', 'Session expired.', {
      status: 401,
      allowOrigin: origin,
    })
  }

  const ip = clientIp(request.headers)
  const perVisitor = consume(`chat:${session.siteId}:${ip}`, PER_VISITOR_PER_MINUTE, 60)
  if (!perVisitor.ok) {
    return widgetError('rate_limited', 'You are sending messages too quickly.', {
      status: 429,
      allowOrigin: origin,
      retryAfter: perVisitor.retryAfter,
    })
  }

  const perSite = consume(`chat-site:${session.siteId}`, PER_SITE_PER_MINUTE, 60)
  if (!perSite.ok) {
    return widgetError('rate_limited', 'This assistant is busy. Try again shortly.', {
      status: 429,
      allowOrigin: origin,
      retryAfter: perSite.retryAfter,
    })
  }

  let body: { question?: unknown; memoryKey?: unknown }
  try {
    body = await request.json()
  } catch {
    return widgetError('invalid_request', 'Malformed request body.', {
      status: 400,
      allowOrigin: origin,
    })
  }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) {
    return widgetError('invalid_request', 'A question is required.', {
      status: 400,
      allowOrigin: origin,
    })
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return widgetError('invalid_request', 'That question is too long.', {
      status: 413,
      allowOrigin: origin,
    })
  }

  // Re-checked against the live row, not trusted from the token: disabling a
  // site has to take effect now, not whenever the last token expires.
  const auth = await authorizeSession(session)
  if (!auth.ok) {
    return widgetError('not_available', 'This assistant is not available.', {
      status: auth.status === 401 ? 401 : 403,
      allowOrigin: origin,
    })
  }

  try {
    const response = await serverN8nClient().chat({
      api_key: auth.companyApiKey,
      question,
      // Scopes the workflow's memory node to one conversation in one browser.
      // Namespaced by site so the same visitor on two of a tenant's sites does
      // not get one thread's context leaking into the other.
      memory_key: typeof body.memoryKey === 'string' ? body.memoryKey : undefined,
      site_id: auth.site.id,
    })

    void recordSiteSeen(auth.site.id, auth.origin, true)

    return widgetJson(
      { answer: response.answer, sources: response.sources ?? [] },
      { allowOrigin: origin },
    )
  } catch (error) {
    // The upstream message can name the workspace key or the workflow's
    // internals, so it is logged and not returned. The visitor is on someone
    // else's website and can do nothing with the detail anyway.
    console.error('[widget] chat upstream failed:', describeError(error))

    const status = error instanceof N8nError && error.isRejectedKey ? 403 : 502
    return widgetError(
      'upstream_error',
      status === 403
        ? 'This assistant is not available.'
        : 'The assistant could not answer just now. Please try again.',
      { status, allowOrigin: origin },
    )
  }
}
