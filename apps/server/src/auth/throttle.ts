/**
 * Best-effort login throttle (fixed window, in memory).
 *
 * Scope, honestly: this state lives in a single Worker isolate and is lost when it recycles, so a determined
 * attacker spread across many isolates/colo can exceed the limit. It stops naive password guessing and credential
 * stuffing bursts, which is the realistic threat for a self-hosted instance with one shared password. For a hard
 * guarantee put a Cloudflare Rate Limiting rule (or Access policy) in front of POST /auth/password.
 */
export const LOGIN_WINDOW_MS = 10 * 60_000;
export const LOGIN_MAX_FAILURES = 8;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 5_000;

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Paranoia: never let a hostile client grow this map without bound.
  if (buckets.size > MAX_TRACKED_KEYS) {
    const overflow = buckets.size - MAX_TRACKED_KEYS;
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= overflow) break;
    }
  }
}

export function loginKeys(ip: string, email: string): string[] {
  return [`ip:${ip}`, `email:${email.toLowerCase()}`];
}

/** True when any of the keys has exhausted its budget. */
export function loginThrottled(keys: string[], now = Date.now()): boolean {
  for (const key of keys) {
    const bucket = buckets.get(key);
    if (bucket && bucket.resetAt > now && bucket.count >= LOGIN_MAX_FAILURES) return true;
  }
  return false;
}

export function recordLoginFailure(keys: string[], now = Date.now()): void {
  if (buckets.size > MAX_TRACKED_KEYS) prune(now);
  for (const key of keys) {
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) buckets.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    else bucket.count += 1;
  }
}

export function clearLoginFailures(keys: string[]): void {
  for (const key of keys) buckets.delete(key);
}

/** Test helper. */
export function resetLoginThrottle(): void {
  buckets.clear();
}