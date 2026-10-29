import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSafeUrl } from "../src/lib/url-safety";
import { BASE, call, devLogin } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const ORIGIN = "https://hark.test";

describe("dev-login host guard", () => {
  it("refuses non-loopback hosts that aren't listed in DEV_LOGIN_HOSTS", async () => {
    // DEV_LOGIN=true is set for the whole suite; only `hark.test` (DEV_LOGIN_HOSTS) may use it.
    const blocked = await SELF.fetch("https://evil.example/auth/dev-login?email=attacker@example.com", {
      redirect: "manual",
    });
    expect(blocked.status).toBe(404);
    expect(blocked.headers.get("Set-Cookie")).toBeNull();

    const allowed = await SELF.fetch(`${BASE}/auth/dev-login?email=dev@example.com`, { redirect: "manual" });
    expect(allowed.status).toBe(302);
  });

  it("still allows loopback hosts (local `pnpm dev`)", async () => {
    const res = await SELF.fetch("http://localhost:8787/auth/dev-login?email=local@example.com", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
  });
});

describe("CSRF guard on cookie sessions", () => {
  it("blocks a cross-origin write", async () => {
    const cookie = await devLogin();
    const r = await call("POST", "/api/tokens", { cookie }, { kind: "webhook", label: "x" }, { Origin: "https://evil.test" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("forbidden");
  });

  it("blocks Sec-Fetch-Site: cross-site even without Origin", async () => {
    const cookie = await devLogin();
    const r = await call("POST", "/api/tokens", { cookie }, { kind: "webhook", label: "x" }, { "Sec-Fetch-Site": "cross-site" });
    expect(r.status).toBe(403);
  });

  it("allows same-origin and header-less (non-browser) writes", async () => {
    const cookie = await devLogin();
    const sameOrigin = await call("POST", "/api/tokens", { cookie }, { kind: "webhook", label: "a" }, { Origin: ORIGIN });
    expect(sameOrigin.status).toBe(201);
    const noHeaders = await call("POST", "/api/tokens", { cookie }, { kind: "webhook", label: "b" });
    expect(noHeaders.status).toBe(201);
  });

  it("leaves Bearer callers and safe methods alone", async () => {
    const cookie = await devLogin();
    const sent = await call("POST", "/api/notifications", { cookie }, { title: "read me" });
    const pairing = await call("POST", "/api/devices/pairing-codes", { cookie });
    const paired = await call("POST", "/api/devices/pair", null, {
      code: pairing.body.code,
      name: "Pixel",
      platform: "android",
    });
    const bearer = paired.body.token as string;

    // A device token can't be replayed by a browser, so Origin is irrelevant for it.
    const viaBearer = await call("POST", `/api/notifications/${sent.body.id}/read`, { bearer }, undefined, {
      Origin: "https://evil.test",
    });
    expect(viaBearer.status).toBe(200);

    const read = await call("GET", "/api/me", { cookie }, undefined, { Origin: "https://evil.test" });
    expect(read.status).toBe(200);
  });

  it("guards logout too", async () => {
    const cookie = await devLogin();
    const blocked = await call("POST", "/auth/logout", { cookie }, undefined, { Origin: "https://evil.test" });
    expect(blocked.status).toBe(403);
    expect((await call("GET", "/api/me", { cookie })).status).toBe(200); // session survived
    expect((await call("POST", "/auth/logout", { cookie })).status).toBe(204);
  });
});

describe("callback URL safety", () => {
  const action = (url: string) => [{ id: "go", label: "Go", callback: { url } }];

  it("rejects loopback / link-local / metadata targets at creation time", async () => {
    const cookie = await devLogin();
    for (const url of [
      "http://127.0.0.1:8080/cb",
      "http://localhost/cb",
      "http://169.254.169.254/latest/meta-data/iam/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://[::1]/cb",
      "ftp://example.com/cb",
    ]) {
      const r = await call("POST", "/api/notifications", { cookie }, { title: "t", actions: action(url) });
      expect(r.status, url).toBe(400);
    }
  });

  it("accepts public and LAN (RFC1918) targets", async () => {
    const cookie = await devLogin();
    for (const url of ["https://example.com/cb", "http://192.168.1.10:8123/api/webhook"]) {
      const r = await call("POST", "/api/notifications", { cookie }, { title: "t", actions: action(url) });
      expect(r.status, url).toBe(201);
    }
  });

  it("refuses to follow a redirect into the metadata service", async () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = new Request(input as RequestInfo, init as RequestInit);
      calls.push(req.url);
      if (req.url === "https://example.com/cb") {
        return new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data/" } });
      }
      return realFetch(input as RequestInfo, init as RequestInit);
    });

    const res = await fetchSafeUrl("https://example.com/cb", { method: "POST" });
    expect(res).toBeNull();
    expect(calls).toEqual(["https://example.com/cb"]); // the metadata hop was never requested
  });

  it("does not request an unsafe URL at all", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await fetchSafeUrl("http://127.0.0.1/cb")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("web push payload", () => {
  it("carries the alert flag so updates can be silent", async () => {
    const cookie = await devLogin();
    const device = await call("POST", "/api/devices/pairing-codes", { cookie });
    const code = String(device.body.code).replace("-", "");
    await call("POST", "/api/devices/pair", null, {
      code,
      name: "Web",
      platform: "web",
      webPush: {
        endpoint: "https://push.example.com/sub",
        keys: { p256dh: env.VAPID_PUBLIC_KEY, auth: "AAAAAAAAAAAAAAAAAAAAAA" },
      },
    });

    const sent = await call("POST", "/api/notifications", { cookie }, { title: "hi" });
    expect(sent.status).toBe(201);
    const r = await call("PATCH", `/api/notifications/${sent.body.id}`, { cookie }, { body: "changed" });
    expect(r.status).toBe(200);
  });
});