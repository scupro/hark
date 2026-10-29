# Hark

**給 AI agent、腳本與 webhook 的單一收件匣。** 用一次 HTTP 呼叫或一次 MCP 工具呼叫送出通知，就能在 Android、macOS
與網頁上收到；進度會即時更新，可加動作按鈕、直接在通知裡回覆，並在各裝置之間同步。

[English](README.md) · [自架說明](docs/setup.md) · [協定文件](docs/protocol.md)

![Hark 網頁收件匣：agent 送來一則提問通知，附作答按鈕與回覆輸入框](docs/screenshots/web-inbox-light.png)

- 🤖 **MCP 伺服器網址**：讓 Claude Code、Codex 或任何 MCP 用戶端取得 `send_notification`、`update_notification`、
  `ask`、`wait_for_response` 等工具。可指定單一裝置（`devices: ["macbook"]`），也可一次送到全部裝置。
- 🪝 **Webhook**：把網址貼進 Home Assistant、Alertmanager、Grafana、AWS SNS、GitHub Actions、cron 或 curl 即可。
- 🔄 **即時通知**：原地更新（進度、狀態）、在所有裝置上一起結束，並記下你的回答。
- 💬 **雙向溝通**：agent 提問，你在任一裝置按下按鈕或輸入回覆，agent 就會拿到答案。
- 🧩 **範本**：一套與平台無關的卡片結構，在各平台上原生呈現。

自由且開源（MIT）。

## 畫面截圖

| 網頁（深色） | macOS |
|---|---|
| ![深色模式的網頁收件匣](docs/screenshots/web-inbox-dark.png) | ![macOS 收件匣視窗中的一段對話](docs/screenshots/macos-inbox.png) |

| 連接 agent 或 webhook | Android | 手機上的網頁版 |
|---|---|---|
| ![Connect 頁面，附 MCP 與 webhook 按鈕](docs/screenshots/web-connect-light.png) | <img src="docs/screenshots/android-inbox.png" alt="Android 收件匣" width="260"> | <img src="docs/screenshots/web-mobile-light.png" alt="手機上的網頁收件匣" width="260"> |

## 取得方式

| 平台 | 方式 |
|---|---|
| **網頁** | 自架：Worker 會在你的網域上直接提供 SPA。無需安裝，用共用密碼登入即可（若啟用 Google 登入，也可用 Google） |
| **Android**（8.0+） | 在 `apps/android` 執行 `./gradlew assembleDebug`，或取用 [Releases](../../releases/latest) 上的 `Hark-x.y.z.apk`。安裝時需允許「安裝未知來源的應用程式」 |
| **macOS**（14+，Apple Silicon 與 Intel） | 執行 `pnpm macos:build`，或取用 [Releases](../../releases/latest) 上的 `Hark-x.y.z-macOS.zip`。未經公證：第一次開啟請**按右鍵 → 打開**（或執行 `xattr -dr com.apple.quarantine /Applications/Hark.app`） |
| **iOS** | 由原始碼自行建置（見 [docs/setup.md](docs/setup.md)）。沒有付費的 Apple 開發者帳號無法散布 iOS 版 |

接著配對裝置：在網頁上點 **Devices → Pair a device**，把出現的代碼輸入 App。發行版由 GitHub Actions 建置與簽章
（[release.yml](.github/workflows/release.yml)），每次都會附上 `SHA256SUMS.txt`。

## 快速開始

1. 先架好自己的實例（見 [docs/setup.md](docs/setup.md)），在 `https://<你的網域>` 登入。
2. 到 **Connect** 頁面，為 agent 建立 MCP 伺服器網址，或為其他來源建立 webhook。
3. 送一則通知：

```bash
# Webhook
curl -d "備份完成" "https://<你的網域>/hook/<webhook-token>?title=Backup&severity=success"

# Claude Code
claude mcp add --transport http hark https://<你的網域>/mcp/<mcp-token>
```

`https://<你的網域>` 就是部署的 `PUBLIC_URL`。本儲存庫以 `hark.app` 作為**佔位網域**；部署前請在
`apps/server/wrangler.jsonc` 中改掉（`PUBLIC_URL`、`VAPID_SUBJECT`、`routes` 三處），需要的話也一併改掉
`apps/android/app/build.gradle.kts` 的預設伺服器網址（`-PharkServerUrl=…`）與
`apps/apple/Sources/HarkKit/Support/Pairing.swift`。

## 文件

| | |
|---|---|
| [docs/setup.md](docs/setup.md) | 自架流程：Cloudflare、登入方式（Google 或共用密碼）、Firebase、網頁、Android、macOS |
| [docs/protocol.md](docs/protocol.md) | API 契約：REST、WebSocket、webhook、MCP 工具、推播 payload |
| [docs/design.md](docs/design.md) | 設計語彙（網頁、macOS、Android 共用） |
| [PLAN.md](PLAN.md) | 產品規劃、決策與現況 |
| [README.md](README.md) | English |

## 專案結構

| 路徑 | 內容 |
|---|---|
| `packages/schema` | 共用的 TypeScript 型別與 zod schema（協定的唯一來源） |
| `apps/server` | Cloudflare Worker：API、MCP、webhook、Durable Objects、D1（Drizzle）、推播派送 |
| `apps/web` | React 網頁應用（由 Worker 提供） |
| `apps/android` | Android 應用（Kotlin、Compose） |
| `apps/apple` | macOS 選單列應用 + iOS 應用（SwiftUI）+ HarkKit |

## 開發

```bash
pnpm install
pnpm dev          # wrangler dev + vite
pnpm test
pnpm android:build
pnpm macos:build
```

**發行：**執行 `git tag v0.2.0 && git push origin v0.2.0`，就會建置簽章後的 APK 與 universal macOS 應用，並發佈到
GitHub Releases。

## 自架注意事項

- **登入**預設是共用密碼（`AUTH_MODE=password`）：用
  `pnpm --filter @hark/server hash-password '<密碼>'` 產生雜湊後設為 `AUTH_PASSWORD_HASH`。想保留 Google 登入就把
  `AUTH_MODE` 改成 `google` 或 `both`。
- **Firebase 是可選的。**儲存庫不附 `apps/android/app/google-services.json`，所以 `assembleDebug` 建出的 App 會走
  WebSocket 傳輸。要啟用 FCM：建立自己的 Firebase 專案（package name 用 `app.hark.android`）、把它的
  `google-services.json` 放進 `apps/android/app/`，並把同一個專案的服務帳號金鑰設為伺服器的
  `FCM_SERVICE_ACCOUNT_JSON`。
- **本專案由 [Oyee](https://github.com/nishkalkashyap/oyee) 改名而來。**Hark 是那個 MIT 授權專案重新命名的版本：套件名稱
  （`@hark/*`）、Durable Object 標頭（`X-Hark-*`）、權杖前綴（`hark_wh_`、`hark_mcp_`、`hark_dev_`）、`hark_session`
  cookie 與 `hark://` URL scheme 都換成新名稱。用舊版建置配對過的裝置需要重新配對；Worker 改名後就是一個全新的
  Worker，不會帶著舊 Worker 的 secret 與 D1 資料。