/**
 * Outbound-request guards for user-supplied URLs (action callbacks).
 *
 * `isSafeCallbackUrl` (schema) rejects loopback / link-local / metadata targets at validation time. This module adds
 * the part that validation alone can't cover: redirects. `fetch` follows redirects by default, so a public URL that
 * answers `302 Location: http://169.254.169.254/` would still reach the metadata service. We therefore follow hops
 * manually, re-validating every Location.
 *
 * Known limit: Workers can't resolve DNS before fetching, so a hostname that resolves to a private address
 * (DNS rebinding) still passes. Loopback/link-local literals and redirects — the realistic attack paths — are blocked.
 */
import { isSafeCallbackUrl } from "@hark/schema";

const MAX_REDIRECTS = 2;

/** Fetches `url` only if it is safe, following at most {@link MAX_REDIRECTS} re-validated redirects. */
export async function fetchSafeUrl(url: string, init: RequestInit = {}): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isSafeCallbackUrl(current)) {
      console.warn(`refusing outbound request to unsafe url: ${current}`);
      return null;
    }
    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.headers.get("Location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.arrayBuffer().catch(() => undefined);
    const next = new URL(location, current).toString();
    if (!isSafeCallbackUrl(next)) {
      console.warn(`refusing redirect to unsafe url: ${next} (from ${current})`);
      return null;
    }
    current = next;
  }
  console.warn(`callback ${url} exceeded ${MAX_REDIRECTS} redirects`);
  return null;
}