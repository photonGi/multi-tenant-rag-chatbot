import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { extractTitle, htmlToText, isPrivateAddress } from '@/lib/url-text'

// node:dns is unavailable on the edge runtime.
export const runtime = 'nodejs'

const FETCH_TIMEOUT_MS = 15_000
const MAX_BYTES = 2_000_000
const MAX_REDIRECTS = 3

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Rejects anything that is not a public http(s) address. */
async function assertPublicUrl(raw: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('That does not look like a valid address.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https addresses can be fetched.')
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '')

  // A literal IP needs no resolution; a name does.
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map((entry) => entry.address)

  if (addresses.length === 0) {
    throw new Error('That address could not be resolved.')
  }

  // Every resolved address must be public — one private answer is enough to
  // make the request unsafe.
  if (addresses.some(isPrivateAddress)) {
    throw new Error('That address resolves to a private network.')
  }

  return parsed
}

/**
 * Follows redirects by hand so every hop is re-checked. Letting fetch follow
 * them automatically would allow a public URL to bounce into a private one.
 */
async function fetchPublicPage(startUrl: string, signal: AbortSignal) {
  let current = startUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await assertPublicUrl(current)

    const response = await fetch(target, {
      signal,
      redirect: 'manual',
      headers: {
        // Some sites serve an error page to unknown agents.
        'user-agent': 'Mozilla/5.0 (compatible; CerebrOS-Ingest/1.0)',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
      },
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('That page redirected without a destination.')
      current = new URL(location, target).toString()
      continue
    }

    return { response, finalUrl: target.toString() }
  }

  throw new Error('That page redirected too many times.')
}

/**
 * Fetches a page and returns its readable text.
 *
 * Exists because the n8n ingest workflow accepts text and files, not URLs — and
 * because the browser cannot fetch third-party pages itself (CORS). Doing it
 * here also keeps the workspace key out of it entirely.
 *
 * Owner-only: an unauthenticated version of this route would be an open proxy
 * for probing networks.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return fail('Sign in to fetch a page.', 401)

  let url: unknown
  try {
    ;({ url } = await request.json())
  } catch {
    return fail('Expected a JSON body containing a url.', 400)
  }

  if (typeof url !== 'string' || !url.trim()) {
    return fail('Enter a website address.', 400)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const { response, finalUrl } = await fetchPublicPage(url.trim(), controller.signal)

    if (!response.ok) {
      return fail(`That page returned ${response.status}.`, 422)
    }

    const type = response.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
      return fail(`That address returned ${type || 'an unsupported type'}.`, 422)
    }

    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_BYTES) {
      return fail('That page is too large to index.', 413)
    }

    const raw = await response.text()
    // content-length is a hint, not a guarantee — cap the body we actually got.
    const html = raw.slice(0, MAX_BYTES)

    const text = /text\/plain/i.test(type) ? html.trim() : htmlToText(html)

    if (text.length < 25) {
      return fail(
        'No readable text was found on that page. It may render entirely in the browser.',
        422,
      )
    }

    return NextResponse.json({
      text,
      title: extractTitle(html),
      url: finalUrl,
      characters: text.length,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return fail('That page took too long to respond.', 504)
    }
    return fail(
      error instanceof Error ? error.message : 'That page could not be fetched.',
      422,
    )
  } finally {
    clearTimeout(timeout)
  }
}
