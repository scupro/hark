/**
 * Password login (AUTH_MODE=password|both).
 *
 * One shared password, one account per email: every email that signs in with the correct password gets its own
 * Hark account, so the per-user isolation of the data model is preserved without an identity provider.
 *
 * The password itself is never stored — only a PBKDF2-HMAC-SHA256 digest lives in the `AUTH_PASSWORD_HASH` secret:
 *
 *     pbkdf2-sha256$<iterations>$<salt-b64url>$<hash-b64url>
 *
 * Generate one with `pnpm --filter @hark/server hash-password 'your password'`.
 *
 * Note on cost: PBKDF2 is CPU-bound. Every login burns `iterations` worth of CPU, which is fine on the Workers Paid
 * plan (30s) but can hit the Free plan's 10ms limit. The iteration count travels inside the hash, so it can be
 * lowered (or raised) without touching code; see docs/setup.md.
 */
import { b64urlDecode, b64urlEncode, randomBytes, timingSafeBytesEqual, utf8 } from "../lib/encoding";

export const PASSWORD_SCHEME = "pbkdf2-sha256";
export const DEFAULT_ITERATIONS = 210_000;

/** Refuse obviously broken hashes (typos, truncated values) instead of silently accepting them. */
const MIN_ITERATIONS = 10_000;
const MAX_ITERATIONS = 4_000_000;
const MIN_SALT_BYTES = 8;
const MIN_HASH_BYTES = 16;

/** Passwords longer than this are rejected outright — no legitimate password needs it, and it bounds CPU work. */
export const MAX_PASSWORD_LENGTH = 1024;

export interface ParsedPasswordHash {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  hash: Uint8Array<ArrayBuffer>;
}

export function parsePasswordHash(encoded: string | undefined | null): ParsedPasswordHash | null {
  if (!encoded) return null;
  const parts = encoded.trim().split("$");
  if (parts.length !== 4) return null;
  const [scheme, iterationsRaw, saltRaw, hashRaw] = parts;
  if (scheme !== PASSWORD_SCHEME) return null;
  if (!iterationsRaw || !/^\d+$/.test(iterationsRaw)) return null;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return null;
  if (!saltRaw || !hashRaw) return null;
  try {
    const salt = b64urlDecode(saltRaw);
    const hash = b64urlDecode(hashRaw);
    if (salt.length < MIN_SALT_BYTES || hash.length < MIN_HASH_BYTES) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  lengthBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/** Derive a hash string. Used by the CLI generator and by tests. */
export async function hashPassword(
  password: string,
  iterations = DEFAULT_ITERATIONS,
  salt: Uint8Array<ArrayBuffer> = randomBytes(16),
  lengthBytes = 32,
): Promise<string> {
  const hash = await derive(password, salt, iterations, lengthBytes);
  return [PASSWORD_SCHEME, String(iterations), b64urlEncode(salt), b64urlEncode(hash)].join("$");
}

/**
 * Constant-time verification. Returns false for malformed hashes so a misconfigured server fails closed
 * (nobody can sign in) rather than open.
 */
export async function verifyPassword(password: string, encoded: string | undefined | null): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  if (!password || password.length > MAX_PASSWORD_LENGTH) return false;
  const derived = await derive(password, parsed.salt, parsed.iterations, parsed.hash.length);
  return timingSafeBytesEqual(derived, parsed.hash);
}

/** True when AUTH_PASSWORD_HASH holds a hash we can actually verify against. */
export function passwordHashConfigured(encoded: string | undefined | null): boolean {
  return parsePasswordHash(encoded) !== null;
}