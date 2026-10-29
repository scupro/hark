#!/usr/bin/env node
/**
 * Generate the AUTH_PASSWORD_HASH secret for Hark's password login.
 *
 *   pnpm --filter @hark/server hash-password 'correct horse battery staple'
 *   printf '%s' "$MY_PASSWORD" | pnpm --filter @hark/server hash-password
 *   PBKDF2_ITERATIONS=100000 pnpm --filter @hark/server hash-password '…'
 *
 * Output format (must stay in sync with src/auth/password.ts):
 *
 *   pbkdf2-sha256$<iterations>$<salt-b64url>$<hash-b64url>
 *
 * Then store it:
 *   cd apps/server && pnpm exec wrangler secret put AUTH_PASSWORD_HASH
 * or, for local development, add it to .dev.vars.
 *
 * Never commit the resulting hash: it's an offline-crackable form of your password.
 */
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const SCHEME = "pbkdf2-sha256";
const DEFAULT_ITERATIONS = 210_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

function fail(message) {
  console.error(`hash-password: ${message}`);
  process.exit(1);
}

let iterations = Number(process.env.PBKDF2_ITERATIONS ?? DEFAULT_ITERATIONS);
const args = process.argv.slice(2);
const positional = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--iterations" || arg === "-n") iterations = Number(args[++i]);
  else if (arg.startsWith("--iterations=")) iterations = Number(arg.slice("--iterations=".length));
  else if (arg === "--help" || arg === "-h") {
    console.log("usage: hash-password [--iterations N] [password]   (omit password to read stdin)");
    process.exit(0);
  } else positional.push(arg);
}

if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 4_000_000) {
  fail("iterations must be an integer between 10000 and 4000000");
}

let password;
if (positional.length > 0) {
  password = positional.join(" ");
} else if (!process.stdin.isTTY) {
  password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
} else {
  fail("no password given (pass it as an argument or pipe it on stdin)");
}

if (!password) fail("password is empty");
if (password.length > 1024) fail("password is longer than 1024 characters");

const salt = randomBytes(SALT_BYTES);
const hash = pbkdf2Sync(password, salt, iterations, KEY_BYTES, "sha256");

// Self-check: the string we print must verify with the same algorithm the Worker uses.
const again = pbkdf2Sync(password, salt, iterations, KEY_BYTES, "sha256");
if (!timingSafeEqual(hash, again)) fail("internal error: hash mismatch");

console.log(`${SCHEME}$${iterations}$${salt.toString("base64url")}$${hash.toString("base64url")}`);