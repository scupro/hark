import type { InboxDO } from "./inbox/do";

/** Bindings, vars and secrets (see PLAN.md §6 and wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  INBOX: DurableObjectNamespace<InboxDO>;
  ASSETS?: Fetcher;

  PUBLIC_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** `google` | `password` | `both`. Unset = google if configured, else password. */
  AUTH_MODE?: string;
  /** `pbkdf2-sha256$<iterations>$<salt>$<hash>` — the shared sign-in password (see scripts/hash-password.mjs). */
  AUTH_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  ALLOWED_EMAILS?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  FCM_SERVICE_ACCOUNT_JSON?: string;
  DEV_LOGIN?: string;
  /** Extra hostnames (comma-separated) allowed to use /auth/dev-login besides loopback. */
  DEV_LOGIN_HOSTS?: string;
}

type HarkEnv = Env;
declare global {
  namespace Cloudflare {
    // Types `env` from "cloudflare:test" / "cloudflare:workers".
    interface Env extends HarkEnv {}
  }
}

export const SERVER_VERSION = "0.1.0";

export function isDevLogin(env: Env): boolean {
  return env.DEV_LOGIN === "true";
}

/** Loopback hosts (`localhost`, `*.localhost`, `127.0.0.0/8` literals, `[::1]`). */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h.endsWith(".localhost")) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * `/auth/dev-login` mints a session for any email, so it must never work on a public host even when `DEV_LOGIN=true`
 * is left on by mistake: loopback is always fine, anything else has to be listed in `DEV_LOGIN_HOSTS`.
 */
export function devLoginAllowed(env: Env, req: Request): boolean {
  if (!isDevLogin(env)) return false;
  const host = new URL(req.url).hostname;
  if (isLoopbackHost(host)) return true;
  const allowed = (env.DEV_LOGIN_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(host.toLowerCase());
}

/** Public origin, e.g. https://hark.example.workers.dev (no trailing slash). Falls back to the request origin. */
export function publicUrl(env: Env, req: Request): string {
  const configured = env.PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(req.url).origin;
}
