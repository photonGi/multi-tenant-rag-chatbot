/**
 * base64url, and a constant-time string comparison.
 *
 * Standard base64 is not safe to put in a URL or a header: '+' and '/' get
 * re-interpreted and '=' padding gets stripped or escaped on the way through
 * proxies. Everything this codebase signs or encrypts travels in one of those
 * places, so it is encoded this way instead.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCodePoint(byte)
  // '=' only ever appears as trailing padding in base64, so replacing every
  // occurrence is the same as stripping the suffix — and avoids an anchored
  // quantifier a hostile input could make backtrack.
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
    return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0)
  } catch {
    return null
  }
}

export function utf8(value: string): Uint8Array {
  return encoder.encode(value)
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

/**
 * Compares two secrets without leaking where they first differ.
 *
 * `a === b` on a string returns as soon as it finds a mismatched character, so
 * the time it takes is a measurement of how many leading characters a guess got
 * right — enough, over enough requests, to recover the secret one character at
 * a time. This always walks the full length.
 *
 * Length is compared first and non-constant-time on purpose: the length of a
 * shared secret is not the part worth hiding, and hashing to equalise it would
 * be more machinery than the threat justifies.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }

  return difference === 0
}
