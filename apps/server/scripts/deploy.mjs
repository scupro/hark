#!/usr/bin/env node
// Full deploy pipeline: build the web assets → apply pending D1 migrations → `wrangler deploy`.
//
// The web build runs first on purpose: `wrangler deploy` uploads whatever sits in apps/web/dist, so a stale build
// would silently ship an old bundle or an old service worker (the web-push `alert` behaviour lives in sw.js).
//
// Extra custom domains come from the git-ignored `.extra-domains` file (one hostname per line, # comments). Wrangler
// replaces a Worker's custom domains on every deploy with exactly the ones it is given, so they must be passed each
// time; keeping them in a local file keeps them out of the repository.
//
// `--dry-run` skips the migrations (they talk to the remote database) and only shows what would be uploaded. Any
// other argument is forwarded to `wrangler deploy`.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(root, "..", "..");
// pnpm forwards arguments after `--`; ignore bare separators so both `pnpm deploy -- --dry-run` and
// `pnpm deploy --dry-run` behave the same.
const passthrough = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = passthrough.includes("--dry-run");

function run(step, args, cwd) {
  console.log(`\n▶ ${step}`);
  const r = spawnSync("pnpm", args, { cwd, stdio: "inherit" });
  if (r.error) {
    console.error(r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("building web assets (apps/web/dist is what gets uploaded)", ["--filter", "@hark/web", "build"], repoRoot);

if (dryRun) {
  console.log("\n▶ skipping D1 migrations (--dry-run)");
} else {
  run("applying pending D1 migrations", ["exec", "wrangler", "d1", "migrations", "apply", "hark", "--remote"], root);
}

const file = join(root, ".extra-domains");
const extra = existsSync(file)
  ? readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.replace(/#.*/, "").trim())
      .filter(Boolean)
  : [];

run(
  `deploying the worker (${extra.length} extra custom domain(s) from .extra-domains)`,
  ["exec", "wrangler", "deploy", ...extra.flatMap((d) => ["--domain", d]), ...passthrough],
  root,
);