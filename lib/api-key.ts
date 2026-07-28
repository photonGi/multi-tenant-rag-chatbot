/**
 * Generates a company API key: 32 random bytes rendered as hex.
 *
 * Uses the Web Crypto API, which is available in every browser and in the
 * Node.js runtime Next.js targets, so keys are never derived from Math.random().
 */
export function generateApiKey(): string {
  const randomBytes = new Uint8Array(32)
  crypto.getRandomValues(randomBytes)
  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
