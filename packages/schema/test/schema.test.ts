import { describe, expect, it } from "vitest";
import { Action, SendNotificationInput, TemplateCard, isSafeCallbackUrl, progressText, renderTemplateValue } from "../src/index";

describe("TemplateCard", () => {
  it("accepts {{var}} placeholders in URL fields", () => {
    const card = {
      title: "{{service}} down",
      image: "{{img}}",
      url: "{{link|https://example.com}}",
      actions: [{ id: "open", label: "Open", url: "{{link}}" }],
    };
    expect(TemplateCard.safeParse(card).success).toBe(true);
  });

  it("rendered output is validated as a real send input", () => {
    const card = TemplateCard.parse({ title: "{{service}} down", image: "{{img}}" });
    const ok = renderTemplateValue(card, { service: "api", img: "https://example.com/a.png" });
    expect(SendNotificationInput.safeParse(ok).success).toBe(true);
    const bad = renderTemplateValue(card, { service: "api", img: "not a url" });
    expect(SendNotificationInput.safeParse(bad).success).toBe(false);
  });
});

describe("renderTemplateValue", () => {
  it("uses fallbacks and empties missing vars", () => {
    expect(renderTemplateValue({ a: "{{x|dflt}}", b: ["{{y}}!"] }, {})).toEqual({ a: "dflt", b: ["!"] });
  });
});

describe("progressText", () => {
  it("formats ratio, percent and indeterminate", () => {
    expect(progressText({ value: 3, max: 7 })).toBe("▓▓▓▓░░░░░░ 3/7");
    expect(progressText({ value: 50 })).toBe("▓▓▓▓▓░░░░░ 50%");
    expect(progressText({ value: 0, indeterminate: true, label: "Deploying" })).toBe("Deploying");
  });
});

describe("isSafeCallbackUrl", () => {
  it("allows public https and http hosts", () => {
    expect(isSafeCallbackUrl("https://example.com/hook")).toBe(true);
    expect(isSafeCallbackUrl("http://example.com:8080/hook?x=1")).toBe(true);
    expect(isSafeCallbackUrl("https://api.eu-west-1.example.co.uk/cb")).toBe(true);
  });

  it("allows RFC1918 (self-hosted LAN) but rejects loopback / link-local / metadata", () => {
    expect(isSafeCallbackUrl("http://192.168.1.10:8123/api/webhook")).toBe(true);
    expect(isSafeCallbackUrl("http://10.0.0.5/cb")).toBe(true);
    expect(isSafeCallbackUrl("http://127.0.0.1/cb")).toBe(false);
    expect(isSafeCallbackUrl("http://127.1.2.3/cb")).toBe(false);
    expect(isSafeCallbackUrl("http://localhost:3000/cb")).toBe(false);
    expect(isSafeCallbackUrl("http://app.localhost/cb")).toBe(false);
    expect(isSafeCallbackUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeCallbackUrl("http://metadata.google.internal/computeMetadata/v1/")).toBe(false);
    expect(isSafeCallbackUrl("http://[::1]/cb")).toBe(false);
    expect(isSafeCallbackUrl("http://[::ffff:127.0.0.1]/cb")).toBe(false);
    expect(isSafeCallbackUrl("http://[fd00::1]/cb")).toBe(false);
    expect(isSafeCallbackUrl("http://0.0.0.0/cb")).toBe(false);
  });

  it("rejects non-http schemes, credentials and junk", () => {
    expect(isSafeCallbackUrl("ftp://example.com/cb")).toBe(false);
    expect(isSafeCallbackUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeCallbackUrl("https://user:pass@example.com/cb")).toBe(false);
    expect(isSafeCallbackUrl("not a url")).toBe(false);
  });

  it("is enforced by the Action schema", () => {
    const base = { id: "ok", label: "OK" };
    expect(Action.safeParse({ ...base, callback: { url: "http://169.254.169.254/steal" } }).success).toBe(false);
    expect(Action.safeParse({ ...base, callback: { url: "https://example.com/hook" } }).success).toBe(true);
  });
});
