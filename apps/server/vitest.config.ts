import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { generateKeyPairSync, webcrypto } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
// @ts-expect-error — plain .mjs helper without types
import { ensureAssets } from "./scripts/ensure-assets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const b64url = (b: ArrayBuffer) => Buffer.from(b).toString("base64url");

/** Throwaway keys so the push fan-out (VAPID + FCM service-account JWT) runs for real against mocked endpoints. */
async function testPushKeys() {
  const vapid = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    VAPID_PUBLIC_KEY: b64url(await webcrypto.subtle.exportKey("raw", vapid.publicKey)),
    VAPID_PRIVATE_KEY: (await webcrypto.subtle.exportKey("jwk", vapid.privateKey)).d!,
    VAPID_SUBJECT: "mailto:test@hark.test",
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
      type: "service_account",
      project_id: "hark-test",
      client_email: "fcm@hark-test.iam.gserviceaccount.com",
      private_key: privateKey,
      token_uri: "https://oauth2.googleapis.com/token",
    }),
    TEST_FCM_PUBLIC_KEY_PEM: publicKey,
  };
}

export default defineConfig(async () => {
  ensureAssets();
  const migrations = await readD1Migrations(path.join(here, "migrations"));
  const pushKeys = await testPushKeys();
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            DEV_LOGIN: "true",
            // The suite talks to https://hark.test, which is not loopback; /auth/dev-login needs an explicit opt-in.
            DEV_LOGIN_HOSTS: "hark.test",
            // Password sign-in is enabled for the whole suite ("both" would also work; Google has no credentials here).
            AUTH_MODE: "both",
            // pbkdf2-sha256, 10k iterations (kept low so tests stay fast) for the password "test-password".
            AUTH_PASSWORD_HASH:
              "pbkdf2-sha256$10000$K1-Ka6RQ6y-SirrdcVXnUw$A5e_RoiGEi8UaP9PlqBwyxTIrFb9N_vEDP4E_zwda1I",
            PUBLIC_URL: "https://hark.test",
            SESSION_SECRET: "test-secret",
            ...pushKeys,
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
      testTimeout: 20_000,
    },
  };
});
