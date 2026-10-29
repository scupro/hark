/**
 * Which sign-in methods this instance offers.
 *
 * `AUTH_MODE` picks the method. When it's unset or invalid the default is **password** login: a shared password needs
 * no OAuth client, and Google sign-in (a consent screen, a GCP project) must be opted into explicitly with `google`
 * or `both`. A mode that names an unconfigured method offers nothing — the login page then explains what to set.
 */
import type { Env } from "../env";
import { passwordHashConfigured } from "./password";

export type AuthMode = "google" | "password" | "both";
export type LoginMethod = "google" | "password";

export function authMode(env: Env): AuthMode {
  const raw = env.AUTH_MODE?.trim().toLowerCase();
  if (raw === "google" || raw === "password" || raw === "both") return raw;
  return "password";
}

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

export function passwordConfigured(env: Env): boolean {
  return passwordHashConfigured(env.AUTH_PASSWORD_HASH);
}

export function googleLoginEnabled(env: Env): boolean {
  const mode = authMode(env);
  return (mode === "google" || mode === "both") && googleConfigured(env);
}

export function passwordLoginEnabled(env: Env): boolean {
  const mode = authMode(env);
  return (mode === "password" || mode === "both") && passwordConfigured(env);
}

/** What the browser should offer, in display order. */
export function enabledLoginMethods(env: Env): LoginMethod[] {
  const methods: LoginMethod[] = [];
  if (googleLoginEnabled(env)) methods.push("google");
  if (passwordLoginEnabled(env)) methods.push("password");
  return methods;
}