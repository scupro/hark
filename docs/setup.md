# Setting up Hark (web + Android + macOS)

> **Just want the apps?** Build them from source (§6, §7), or take the Android APK / macOS app from
> [GitHub Releases](https://github.com/scupro/hark/releases/latest).

This is the procedure used for the reference deployment. The repository uses `hark.app` as a **placeholder**
host: replace it with your own domain in `apps/server/wrangler.jsonc` (`PUBLIC_URL`, `VAPID_SUBJECT`, `routes`).
Follow the steps to run your own instance, or to redeploy from a new machine. iOS is not covered yet (see
PLAN.md §10).

> **Deploying from a new laptop?** You only need steps 0, 1 and 4.6. Worker secrets live in Cloudflare and
> persist across deploys, so no secrets files are required. You need them only to *rotate* secrets (see §4.4).

---

## 0. Prerequisites

| Tool | Needed for | Install |
|---|---|---|
| Node ≥ 22 + pnpm | server + web | `brew install node pnpm` |
| Cloudflare account with your domain on it | hosting | <https://dash.cloudflare.com> |
| Google account | OAuth + Firebase | — |
| JDK 21 + Android SDK 36 | Android build | see §6.1 |
| Xcode (or just the Command Line Tools) | macOS build | App Store / `xcode-select --install` |

## 1. Clone and install

```sh
git clone https://github.com/scupro/hark.git && cd hark
pnpm install
pnpm --dir apps/server exec wrangler login      # opens the browser once
```

## 2. Firebase (Android push)

Use **one Google Cloud project for both Firebase and OAuth**: creating a Firebase project creates a GCP project too.

1. <https://console.firebase.google.com> → **Add project** (Analytics not needed).
2. **Add app → Android**. Package name **`app.hark.android`** → **Register** → download **`google-services.json`**.
   Skip the SDK steps. Put the file at `apps/android/app/google-services.json`. It is public config and is committed.
3. **Project settings → Service accounts → Generate new private key** → a JSON file. This becomes the
   `FCM_SERVICE_ACCOUNT_JSON` secret. **Keep it private.**
4. Optional: in **GCP → APIs & Services → Credentials**, restrict the Android API key to the *Firebase Installations*
   and *FCM Registration* APIs.

## 3. Sign-in method

`AUTH_MODE` selects what the server offers: `google`, `password` or `both`. **Password is the default** — if it's
unset (or holds an unknown value) the server offers shared-password sign-in, and Google must be opted into explicitly
with `"google"` or `"both"` (it needs an OAuth client either way). Pick one of the two sections below — Google sign-in
is entirely optional.

### 3A. Password sign-in (no Google, recommended for self-hosting)

One shared password; every email that signs in with it gets its own account and inbox.

```sh
pnpm --filter @hark/server hash-password 'your long password'
# → pbkdf2-sha256$210000$<salt>$<hash>
```

Store the output as the `AUTH_PASSWORD_HASH` secret (4.4) and set `vars.AUTH_MODE = "password"`. No OAuth client,
no GCP project, no `GOOGLE_CLIENT_ID`.

Notes:
- Only the hash is stored: a leaked `wrangler.jsonc` or dashboard screenshot doesn't expose the password.
- Rotate with `wrangler secret put AUTH_PASSWORD_HASH` (everyone stays signed in; only new logins change).
- Use a long password (≥ 20 characters, e.g. from a password manager) — it is the only door.
- PBKDF2 is CPU work per login (~100–250 ms at 210k iterations). That's fine on Workers Paid; the **Free plan's
  10 ms CPU limit** will make logins fail, so lower the cost there:
  `PBKDF2_ITERATIONS=100000 pnpm --filter @hark/server hash-password '…'` (the iteration count travels inside the
  hash, so lowering it needs no redeploy of code).
- Failed logins are throttled per IP and per email (8 failures / 10 min, best effort per isolate). For a hard limit
  add a Cloudflare Rate Limiting rule on `POST /auth/password`.
- `ALLOWED_EMAILS` still applies: set it to restrict which addresses may create an account.
- If the correct password is rejected, the hash is almost certainly mistyped — it is case-sensitive and exactly
  87 characters at the default settings. Regenerate it instead of retyping, and paste it with
  `wrangler secret put` rather than editing JSON by hand. A malformed hash fails closed (the server then
  advertises no password login at all, and `/api/config` returns `"authModes": []`).

### 3B. Google sign-in (OAuth)

In <https://console.cloud.google.com>, with the **same project** selected:

1. **Google Auth Platform → Branding**: app name, support email.
2. **Audience**: *External*, then **Publish app**. In *Testing* only listed test users can sign in. Basic scopes
   (`openid email profile`) need no Google verification.
3. **Clients → Create client → Web application**. **Authorized redirect URIs**:
   - `https://<your-host>/auth/google/callback`
   - `http://localhost:8787/auth/google/callback` (local dev)
4. Download the client JSON (`client_id`, `client_secret`) and set `vars.AUTH_MODE = "google"` (or `"both"`).

## 4. Cloudflare (server + web)

### 4.1 Database
```sh
cd apps/server
pnpm exec wrangler d1 create hark      # prints database_id
```

### 4.2 `apps/server/wrangler.jsonc`
Set these (non-secret) values:

| Key | Value |
|---|---|
| `d1_databases[0].database_id` | id from 4.1 |
| `routes` | `[{ "pattern": "<your-host>", "custom_domain": true }]` (the domain's zone must be on your account), or remove for `*.workers.dev` |
| `vars.PUBLIC_URL` | `https://<your-host>` |
| `vars.AUTH_MODE` | `password` (default), `google` or `both` (see §3) |
| `vars.GOOGLE_CLIENT_ID` | only for Google sign-in (§3B) |
| `vars.VAPID_PUBLIC_KEY` | from 4.3 |
| `vars.VAPID_SUBJECT` | `https://<your-host>` or `mailto:you@…` |
| `vars.ALLOWED_EMAILS` | empty = anyone who can sign in gets an account; or `a@b.com,@company.com` |
| `vars.DEV_LOGIN` | **`"false"`** in production (host-gated, but keep it off) |
| `vars.DEV_LOGIN_HOSTS` | leave empty; only for tests/dev on a non-loopback host |

### 4.3 Generate keys
```sh
node scripts/generate-vapid-keys.mjs     # VAPID_PUBLIC_KEY → wrangler.jsonc, VAPID_PRIVATE_KEY → secret
openssl rand -base64 48                  # SESSION_SECRET
```

### 4.4 Secrets
Create a **temporary** JSON file outside the repo (e.g. `~/hark-secrets.json`):
```json
{
  "SESSION_SECRET": "…",
  "VAPID_PRIVATE_KEY": "…",
  "AUTH_PASSWORD_HASH": "pbkdf2-sha256$…",
  "GOOGLE_CLIENT_SECRET": "…",
  "FCM_SERVICE_ACCOUNT_JSON": "<the service-account JSON, as one string>"
}
```
It's uploaded with the first deploy (4.6) or with `wrangler secret bulk ~/hark-secrets.json`. Delete it afterwards,
or keep it in a password manager. Rotating later: `wrangler secret put NAME`.

`AUTH_PASSWORD_HASH` is only needed for password sign-in (§3A), `GOOGLE_CLIENT_SECRET` only for Google sign-in (§3B),
and `FCM_SERVICE_ACCOUNT_JSON` only for Android push.

What breaks if a secret is lost or rotated: `SESSION_SECRET` signs everyone out; `VAPID_PRIVATE_KEY` requires every
browser to re-enable notifications; a new `AUTH_PASSWORD_HASH` changes the sign-in password. The Google/Firebase
secrets can be regenerated in their consoles at any time.

### 4.5 Migrations (Drizzle)
The schema is in `src/db/schema.ts`; `migrations/` is generated by drizzle-kit and applied by wrangler. `pnpm deploy`
applies pending migrations automatically. After schema changes: `pnpm --filter @hark/server db:generate` (see the
server README).

### 4.6 Deploy
```sh
# first deploy (uploads secrets):
pnpm --filter @hark/web build && cd apps/server && pnpm exec wrangler d1 migrations apply hark --remote \
  && pnpm exec wrangler deploy --secrets-file ~/hark-secrets.json
# every later deploy, from the repo root. `pnpm deploy` builds the web assets first (the upload takes
# apps/web/dist as-is, so a stale build would ship an old service worker), then applies pending migrations,
# then uploads:
pnpm deploy
# rehearse without touching the database or the account (builds + bundles only):
pnpm deploy:check
```
Verify: `curl https://<your-host>/api/config` → `fcmEnabled: true`, `vapidPublicKey` set, `devLogin: false`.

## 5. Web

1. Open `https://<your-host>` → **Sign in with Google**.
2. **Devices → Enable notifications in this browser** and allow the prompt.
   - **Brave** blocks Web Push by default: `brave://settings/privacy` → enable **Use Google services for push
     messaging** → restart Brave → try again (the page shows this hint automatically).

## 6. Android

### 6.1 Toolchain (once)
```sh
brew install openjdk@21 gradle
brew install --cask android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
yes | sdkmanager --sdk_root=$ANDROID_HOME --licenses
sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

### 6.2 Build
```sh
cd apps/android
./gradlew assembleDebug -PharkServerUrl=https://<your-host>    # default server URL is hark.app
# → app/build/outputs/apk/debug/app-debug.apk (debug-signed; never distributed via Play Store)
```
FCM is enabled only when `app/google-services.json` exists at build time. Without it the app falls back to its
WebSocket foreground service.

### 6.3 Install
- **USB**: phone → *Settings → About → Software information → tap Build number 7×* → *Developer options →
  USB debugging*. Plug in, **unlock the phone and accept "Allow USB debugging?"** (tick *Always allow*), then:
  ```sh
  $ANDROID_HOME/platform-tools/adb devices          # must show "<serial>  device"
  $ANDROID_HOME/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
  ```
  If `adb devices` is empty while macOS sees the phone (`usb_read failed … e00002ed` in the adb log), the phone
  hasn't authorized this Mac: unlock it, set USB mode to *File transfer*, or *Revoke USB debugging authorizations*
  and replug.
- **Or** copy the APK to the phone and open it (allow *Install unknown apps*).

### 6.4 Pair
Web → **Devices → Pair a device** → type the `XXXX-XXXX` code into the app, or scan the QR code with the phone
camera (opens a `hark://pair` link, which you confirm in the app). Allow notifications. In Settings, consider
exempting Hark from battery optimization if you use the WebSocket mode.

## 7. macOS

```sh
cd apps/apple
scripts/build-macos-app.sh                  # no Xcode needed → build/Hark.app (ad-hoc signed)
open build/Hark.app                       # move it to /Applications to keep it
# or develop it in Xcode:
brew install xcodegen && xcodegen generate && open Hark.xcodeproj   # scheme Hark-macOS
```
Allow notifications → menu-bar icon → pair with a code from **Devices → Pair a device**. The server URL is
prefilled (`Pairing.defaultServerURL`). Enable **Launch at login** in Settings. The menu-bar app keeps a WebSocket open;
there is no APNs (by design, no paid Apple account).

## 8. Connect agents and webhooks

**Connect** page → **Create MCP server URL** / **Create webhook** (shown once; revoke anytime).

```sh
claude mcp add --transport http hark https://<your-host>/mcp/<token>        # Claude Code
curl -d "Backup finished" "https://<your-host>/hook/<token>?title=Backup&severity=success"
```
The page also has snippets for Codex, generic MCP JSON, Home Assistant, Alertmanager/Grafana and GitHub Actions.

## 9. Local development

```sh
cp apps/server/.dev.vars.example apps/server/.dev.vars    # DEV_LOGIN=true, PUBLIC_URL=http://localhost:8787
pnpm dev                                                   # wrangler dev :8787 + vite
```
Sign in at `http://localhost:8787/auth/dev-login?email=you@example.com&redirect=/`. Android emulator → server
`http://10.0.2.2:8787`. Debug builds allow cleartext to local addresses.

## 10. Publishing releases (maintainers)

1. Android release key (once): `keytool -genkeypair -keystore hark-release.jks -storetype PKCS12 -alias hark
   -keyalg RSA -keysize 4096 -validity 36500`. **Back it up**; every APK must be signed with it.
2. Repo secrets (once): `ANDROID_KEYSTORE_BASE64` (`base64 -i hark-release.jks`), `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
3. Release: `git tag v0.2.0 && git push origin v0.2.0`. The workflow runs the Android and Swift tests, builds the signed
   APK and the universal macOS app, and publishes the GitHub Release with checksums.
