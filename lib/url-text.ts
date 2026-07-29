/**
 * HTML → readable text, and the address checks that make fetching a
 * caller-supplied URL safe to do from the server.
 */

const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — cloud metadata lives here
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
]

function v4ToInt(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null

  let value = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

/**
 * True for anything that is not a public internet address.
 *
 * The link-local range matters most: 169.254.169.254 is the cloud metadata
 * endpoint, and reaching it from a server-side fetch is the classic SSRF prize.
 */
export function isPrivateAddress(address: string): boolean {
  const normalised = address.toLowerCase()

  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is still that IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised)
  if (mapped) return isPrivateAddress(mapped[1])

  if (normalised.includes(':')) {
    if (normalised === '::1' || normalised === '::') return true
    const head = normalised.split(':')[0]
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast
    return /^f[cd]/.test(head) || /^fe[89ab]/.test(head) || head.startsWith('ff')
  }

  const value = v4ToInt(normalised)
  if (value === null) return true // unparseable is not provably public

  return BLOCKED_V4.some(([base, bits]) => {
    const baseValue = v4ToInt(base)
    if (baseValue === null) return false
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0
    return (value & mask) >>> 0 === (baseValue & mask) >>> 0
  })
}

const DROPPED_ELEMENTS =
  /<(script|style|noscript|template|svg|canvas|iframe|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi

const BLOCK_BOUNDARIES =
  /<\/(p|div|section|article|header|li|tr|h[1-6]|blockquote|pre|td)\s*>|<br\s*\/?>/gi

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
}

export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!match) return null

  const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim()
  return title || null
}

/**
 * Good-enough readable text for retrieval. Not a full DOM parse — chunks get
 * embedded, so exact structure matters far less than dropping the markup,
 * scripts and chrome that would otherwise pollute the index.
 */
/**
 * Removes tags in a single pass.
 *
 * A regex like `/<[^>]+>/g` degrades to quadratic on input full of unclosed
 * `<`, and this runs on whatever an arbitrary page chose to serve. A scanner
 * has no backtracking to exploit.
 */
function stripTags(input: string): string {
  const out: string[] = []
  let inTag = false

  for (const char of input) {
    if (char === '<') {
      inTag = true
      out.push(' ')
    } else if (char === '>') {
      inTag = false
    } else if (!inTag) {
      out.push(char)
    }
  }

  return out.join('')
}

export function htmlToText(html: string): string {
  return decodeEntities(
    stripTags(
      html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(DROPPED_ELEMENTS, ' ')
        .replace(BLOCK_BOUNDARIES, '\n'),
    ),
  )
    .replaceAll('\r', '')
    .replace(/[ \t\f\v]+/g, ' ')
    // Stripping an inline tag mid-sentence ("<b>$40</b>.") leaves a gap before
    // the punctuation.
    .replace(/ +([.,;:!?)\]])/g, '$1')
    .replace(/([([]) +/g, '$1')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
