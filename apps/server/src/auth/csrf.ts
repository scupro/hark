import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../app";
import { publicUrl } from "../env";
import { forbidden } from "../lib/errors";
import { SESSION_COOKIE } from "./principal";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

/**
 * CSRF guard for cookie-authenticated, state-changing requests.
 *
 * Bearer-token callers (apps, scripts, MCP) can't be driven by a browser, so they're never subject to this check.
 * Browser sessions send `Origin` on every POST/PATCH/DELETE; a cross-origin or sibling-subdomain origin is rejected.
 * Requests with no `Origin` at all (curl, tests, native clients holding a cookie) are allowed — a browser can't omit
 * `Origin` on a cross-site write, so this closes the CSRF hole without breaking non-browser clients.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method.toUpperCase())) return next();
  if (!getCookie(c, SESSION_COOKIE)) return next();
  if (/^Bearer\s+/i.test(c.req.header("Authorization") ?? "")) return next();

  const allowed = new Set([new URL(c.req.url).origin, normalizeOrigin(publicUrl(c.env, c.req.raw))].filter(Boolean));
  const origin = c.req.header("Origin");
  if (origin) {
    if (!allowed.has(normalizeOrigin(origin))) throw forbidden("Cross-origin request blocked");
    return next();
  }
  const site = (c.req.header("Sec-Fetch-Site") ?? "").toLowerCase();
  if (site === "cross-site" || site === "same-site") throw forbidden("Cross-site request blocked");
  return next();
};