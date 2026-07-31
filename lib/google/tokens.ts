import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from '@/lib/crypto/encoding'

/**
 * Envelope encryption for the Google tokens, so the database never holds a
 * usable credential.
 *
 * WHAT THIS PROTECTS AGAINST
 * --------------------------
 * A refresh token is a standing grant over a tenant's calendar and outbound
 * mail that does not expire on its own. In plaintext, every copy of the
 * database — a nightly backup, a read replica, a support engineer's psql
 * session, a screenshot of the table editor — is a copy of every tenant's
 * mailbox. Encrypting in the app with a key held only in the environment means
 * the database on its own is inert: an attacker needs the process's env too.
 *
 * It does NOT protect against an attacker who has already run code on the
 * server, and it is not meant to. That case is what disconnect and Google's own
 * revoke page are for.
 *
 * AES-256-GCM rather than CBC or a raw cipher: GCM authenticates as well as
 * encrypts, so a row an attacker with database write access has tampered with
 * fails to decrypt instead of quietly yielding a token pointed somewhere else.
 *
 * FORMAT
 * ------
 *   v1.<base64url iv>.<base64url ciphertext‖tag>
 *
 * The version prefix is the part that matters later: rotating to a new key or a
 * new cipher becomes "write v2, keep reading v1" rather than a migration that
 * has to rewrite every row in one transaction.
 */

const VERSION = 'v1'

/** 96 bits — the size GCM is specified around, and the only one worth using. */
const IV_BYTES = 12

const KEY_ENV = 'TOKEN_ENCRYPTION_KEY'
const KEY_HEX_LENGTH = 64 // 32 bytes = AES-256

/**
 * The key never appears in source. It is read from the environment on first
 * use and cached as a non-extractable CryptoKey, so nothing downstream can
 * read the raw bytes back out of it.
 */
let cachedKey: Promise<CryptoKey> | null = null

function keyMaterial(): Uint8Array {
  if (typeof window !== 'undefined') {
    throw new Error(
      'Google token encryption was called in the browser. The encryption key must never reach the client.',
    )
  }

  const configured = process.env[KEY_ENV]?.trim()

  if (!configured) {
    throw new Error(
      `Missing ${KEY_ENV} — Google tokens cannot be encrypted. Generate one with: openssl rand -hex 32`,
    )
  }

  // Strict rather than forgiving: a short or mistyped key would otherwise be
  // accepted here and produce ciphertext nobody can decrypt later.
  if (!new RegExp(`^[0-9a-fA-F]{${KEY_HEX_LENGTH}}$`).test(configured)) {
    throw new Error(
      `${KEY_ENV} must be ${KEY_HEX_LENGTH} hex characters (32 bytes). Generate one with: openssl rand -hex 32`,
    )
  }

  const bytes = new Uint8Array(KEY_HEX_LENGTH / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(configured.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

function encryptionKey(): Promise<CryptoKey> {
  cachedKey ??= crypto.subtle
    .importKey('raw', keyMaterial() as unknown as ArrayBuffer, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ])
    .catch((error: unknown) => {
      // A cached rejected promise would be handed back forever, turning one bad
      // import into permanent failure for the life of the instance.
      cachedKey = null
      throw error
    })

  return cachedKey
}

/**
 * Encrypts a token for storage. Throws if the key is missing or malformed —
 * writing a plaintext token because the environment was misconfigured is the
 * one outcome this module must never produce.
 */
export async function encryptToken(plaintext: string): Promise<string> {
  // A fresh IV per encryption. Reusing one under the same key is the failure
  // that breaks GCM outright, so it is generated here and never chosen by a
  // caller.
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))

  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    await encryptionKey(),
    utf8(plaintext) as unknown as ArrayBuffer,
  )

  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`
}

/**
 * Decrypts a stored token, or returns null.
 *
 * Null rather than a throw: every caller's correct response to "this row cannot
 * be decrypted" is the same as its response to "there is no row" — treat the
 * connection as unusable and ask the owner to reconnect. A throw would only
 * mean writing that mapping at each call site.
 */
export async function decryptToken(envelope: string | null | undefined): Promise<string | null> {
  if (!envelope) return null

  const parts = envelope.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION) return null

  const iv = fromBase64Url(parts[1])
  const sealed = fromBase64Url(parts[2])
  if (!iv || iv.length !== IV_BYTES || !sealed) return null

  try {
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
      await encryptionKey(),
      sealed as unknown as ArrayBuffer,
    )

    return fromUtf8(new Uint8Array(opened))
  } catch {
    // Wrong key, or a tampered row. GCM's tag check is what turns the second
    // case into a failure here instead of a plausible-looking wrong answer.
    return null
  }
}

/** True when the environment is set up well enough to store a connection. */
export function tokenEncryptionConfigured(): boolean {
  try {
    keyMaterial()
    return true
  } catch {
    return false
  }
}
