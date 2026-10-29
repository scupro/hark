import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { enabledLoginMethods, googleLoginEnabled, passwordLoginEnabled, type LoginMethod } from "../src/auth/mode";
import { hashPassword, parsePasswordHash, verifyPassword } from "../src/auth/password";
import { resetLoginThrottle } from "../src/auth/throttle";
import { BASE, call, uniqueEmail } from "./helpers";

const PASSWORD = "test-password";

/** Submit the login form the way a browser would. */
async function submitLogin(fields: Record<string, string>, contentType = "application/x-www-form-urlencoded") {
  const body = contentType === "application/json" ? JSON.stringify(fields) : new URLSearchParams(fields).toString();
  return SELF.fetch(`${BASE}/auth/password`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
    redirect: "manual",
  });
}

function sessionCookie(res: Response): string | null {
  const raw = res.headers.get("Set-Cookie") ?? "";
  const match = /hark_session=([^;]+)/.exec(raw);
  return match ? `hark_session=${match[1]}` : null;
}

beforeEach(() => resetLoginThrottle());

describe("password hashing", () => {
  it("round-trips a generated hash", async () => {
    const encoded = await hashPassword("correct horse battery staple", 10_000);
    expect(encoded).toMatch(/^pbkdf2-sha256\$10000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", encoded)).toBe(false);
    expect(await verifyPassword("", encoded)).toBe(false);
  });

  it("accepts the hash produced by scripts/hash-password.mjs and rejects tampered ones", async () => {
    // Copied verbatim from `node scripts/hash-password.mjs --iterations 10000 'test-password'`.
    const fromCli = "pbkdf2-sha256$10000$K1-Ka6RQ6y-SirrdcVXnUw$A5e_RoiGEi8UaP9PlqBwyxTIrFb9N_vEDP4E_zwda1I";
    expect(await verifyPassword(PASSWORD, fromCli)).toBe(true);
    expect(await verifyPassword("test-passwore", fromCli)).toBe(false);
    expect(fromCli).toBe(env.AUTH_PASSWORD_HASH);
  });

  it("fails closed on malformed hashes", async () => {
    const cases = [
      "",
      "nope",
      "pbkdf2-sha1$10000$abc$def",
      "pbkdf2-sha256$999$K1-Ka6RQ6y-SirrdcVXnUw$A5e_RoiGEi8UaP9PlqBwyxTIrFb9N_vEDP4E_zwda1I",
      "pbkdf2-sha256$10000$short$A5e_RoiGEi8UaP9PlqBwyxTIrFb9N_vEDP4E_zwda1I",
      "pbkdf2-sha256$10000$K1-Ka6RQ6y-SirrdcVXnUw",
    ];
    for (const encoded of cases) {
      expect(parsePasswordHash(encoded)).toBeNull();
      expect(await verifyPassword(PASSWORD, encoded)).toBe(false);
    }
  });

  it("rejects absurdly long passwords without hashing", async () => {
    const encoded = await hashPassword(PASSWORD, 10_000);
    expect(await verifyPassword("x".repeat(5000), encoded)).toBe(false);
  });
});

describe("AUTH_MODE resolution", () => {
  const base = { ...env } as typeof env;
  const without = (over: Record<string, string | undefined>) => ({ ...base, ...over }) as typeof env;

  it("defaults to password when AUTH_MODE is unset, even with Google credentials present", () => {
    const e = without({ AUTH_MODE: undefined, AUTH_PASSWORD_HASH: base.AUTH_PASSWORD_HASH, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
    expect(enabledLoginMethods(e)).toEqual<LoginMethod[]>(["password"]);
  });

  it("needs an explicit mode for Google sign-in", () => {
    const googleOnly = without({ AUTH_MODE: undefined, AUTH_PASSWORD_HASH: "", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
    expect(enabledLoginMethods(googleOnly)).toEqual<LoginMethod[]>([]);
  });

  it("falls back to password when only a password hash is configured", () => {
    const e = without({ AUTH_MODE: undefined, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined });
    expect(enabledLoginMethods(e)).toEqual<LoginMethod[]>(["password"]);
  });

  it("honours an explicit mode and never offers an unconfigured method", () => {
    const passwordOnly = without({ AUTH_MODE: "password", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
    expect(passwordLoginEnabled(passwordOnly)).toBe(true);
    expect(googleLoginEnabled(passwordOnly)).toBe(false);
    expect(enabledLoginMethods(passwordOnly)).toEqual<LoginMethod[]>(["password"]);

    const both = without({ AUTH_MODE: "both", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
    expect(enabledLoginMethods(both)).toEqual<LoginMethod[]>(["google", "password"]);

    // A mode that names an unconfigured method offers nothing (fail closed, not open).
    // Explicitly unset the credentials: the test worker may inherit them from wrangler.jsonc / .dev.vars.
    const googleOnlyNoCreds = without({ AUTH_MODE: "google", GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined });
    expect(enabledLoginMethods(googleOnlyNoCreds)).toEqual<LoginMethod[]>([]);
    expect(passwordLoginEnabled(googleOnlyNoCreds)).toBe(false);

    const googleOnly = without({ AUTH_MODE: "google", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
    expect(enabledLoginMethods(googleOnly)).toEqual<LoginMethod[]>(["google"]);
    expect(passwordLoginEnabled(googleOnly)).toBe(false);

    const nothing = without({ AUTH_MODE: "password", AUTH_PASSWORD_HASH: "" });
    expect(enabledLoginMethods(nothing)).toEqual<LoginMethod[]>([]);
  });

  it("ignores an invalid AUTH_MODE value and keeps the derived behaviour", () => {
    const e = without({ AUTH_MODE: "magic", GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined });
    expect(enabledLoginMethods(e)).toEqual<LoginMethod[]>(["password"]);
  });
});

describe("POST /auth/password", () => {
  it("signs in with a correct password and exposes the account", async () => {
    const email = uniqueEmail();
    const res = await submitLogin({ email, password: PASSWORD, redirect: "/inbox" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/inbox");
    const cookie = sessionCookie(res);
    expect(cookie).not.toBeNull();
    expect(res.headers.get("Set-Cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("Set-Cookie")).toMatch(/SameSite=Lax/i);

    const me = await call("GET", "/api/me", { cookie: cookie! });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
    expect(me.body.name).toBe(email.split("@")[0]);
  });

  it("accepts a JSON body too", async () => {
    const email = uniqueEmail();
    const res = await submitLogin({ email, password: PASSWORD }, "application/json");
    expect(res.status).toBe(302);
    expect(sessionCookie(res)).not.toBeNull();
  });

  it("lower-cases the email so the same person keeps one account", async () => {
    const email = uniqueEmail();
    const first = await submitLogin({ email, password: PASSWORD });
    const second = await submitLogin({ email: email.toUpperCase(), password: PASSWORD });
    const a = await call("GET", "/api/me", { cookie: sessionCookie(first)! });
    const b = await call("GET", "/api/me", { cookie: sessionCookie(second)! });
    expect(a.body.id).toBe(b.body.id);
    expect(a.body.email).toBe(email);
  });

  it("keeps separate accounts for separate emails (multi-account)", async () => {
    const one = uniqueEmail();
    const two = uniqueEmail();
    const a = await call("GET", "/api/me", { cookie: sessionCookie(await submitLogin({ email: one, password: PASSWORD }))! });
    const b = await call("GET", "/api/me", { cookie: sessionCookie(await submitLogin({ email: two, password: PASSWORD }))! });
    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.email).toBe(one);
    expect(b.body.email).toBe(two);
  });

  it("rejects a wrong password without setting a cookie or revealing the email", async () => {
    const email = uniqueEmail();
    const res = await submitLogin({ email, password: "wrong", redirect: "/inbox" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    const location = new URL(res.headers.get("Location")!, BASE);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("bad_password");
    expect(location.searchParams.get("email")).toBe(email);
    expect(location.searchParams.get("redirect")).toBeNull(); // never echo an unvalidated redirect
  });

  it("rejects an invalid email before hashing", async () => {
    const res = await submitLogin({ email: "not-an-email", password: PASSWORD });
    expect(res.headers.get("Location")).toBe("/login?error=bad_email");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects empty submissions", async () => {
    const res = await submitLogin({});
    expect(new URL(res.headers.get("Location")!, BASE).searchParams.get("error")).toBe("bad_email");
  });

  it("never redirects off-site", async () => {
    const res = await submitLogin({ email: uniqueEmail(), password: PASSWORD, redirect: "//evil.com/inbox" });
    expect(res.headers.get("Location")).toBe("/");
  });

  it("throttles repeated failures per email", async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 8; i++) {
      const res = await submitLogin({ email, password: `wrong-${i}` });
      expect(new URL(res.headers.get("Location")!, BASE).searchParams.get("error")).toBe("bad_password");
    }
    // Even the right password is refused now.
    const blocked = await submitLogin({ email, password: PASSWORD });
    expect(new URL(blocked.headers.get("Location")!, BASE).searchParams.get("error")).toBe("too_many_attempts");
    expect(blocked.headers.get("Set-Cookie")).toBeNull();

    // The client IP is throttled as well, so another email from the same client is blocked too.
    const otherIpSameClient = await submitLogin({ email: uniqueEmail(), password: PASSWORD });
    expect(new URL(otherIpSameClient.headers.get("Location")!, BASE).searchParams.get("error")).toBe(
      "too_many_attempts",
    );

    // Once the window is cleared, a different account signs in fine again.
    resetLoginThrottle();
    const fresh = await submitLogin({ email: uniqueEmail(), password: PASSWORD });
    expect(fresh.headers.get("Location")).toBe("/");
    expect(sessionCookie(fresh)).not.toBeNull();
  });

  it("honours ALLOWED_EMAILS before creating an account", async () => {
    const mutable = env as unknown as Record<string, unknown>;
    const previous = mutable.ALLOWED_EMAILS;
    try {
      mutable.ALLOWED_EMAILS = "alice@example.com, @corp.example";
      const blocked = await submitLogin({ email: uniqueEmail(), password: PASSWORD });
      const location = new URL(blocked.headers.get("Location")!, BASE);
      expect(location.searchParams.get("error")).toBe("not_allowed");
      expect(blocked.headers.get("Set-Cookie")).toBeNull();

      const allowed = await submitLogin({ email: "alice@example.com", password: PASSWORD });
      expect(allowed.headers.get("Location")).toBe("/");
      expect(sessionCookie(allowed)).not.toBeNull();

      // Domain suffixes in the allowlist work too.
      const byDomain = await submitLogin({ email: "someone@corp.example", password: PASSWORD });
      expect(sessionCookie(byDomain)).not.toBeNull();
    } finally {
      mutable.ALLOWED_EMAILS = previous;
      resetLoginThrottle();
    }
  });

  it("is disabled when AUTH_MODE excludes password", async () => {
    const mutable = env as unknown as Record<string, unknown>;
    const previous = mutable.AUTH_MODE;
    try {
      mutable.AUTH_MODE = "google";
      const res = await submitLogin({ email: uniqueEmail(), password: PASSWORD });
      expect(res.headers.get("Location")).toBe("/login?error=password_disabled");
      expect(res.headers.get("Set-Cookie")).toBeNull();
    } finally {
      mutable.AUTH_MODE = previous;
    }
  });
});