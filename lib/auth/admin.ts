// ============================================================
// lib/auth/admin.ts
//
// Who counts as the admin, read from configuration rather than stored
// as a flag someone could flip in the database.
//
// This exists to solve the bootstrap problem: every account is created
// 'pending' and needs an admin to approve it, so the first admin cannot
// come from that same queue. Matching an identity against configuration
// lets exactly one account skip the queue, and moving the admin later is
// an environment variable change rather than a data migration.
// ============================================================

import "server-only";

const lower = (value: string | null | undefined) =>
  value?.trim().toLowerCase() || null;

/** GitHub login that is granted admin on first sign-in. */
export const adminGithubLogin = () => lower(process.env.ADMIN_GITHUB_LOGIN);

/** Email allowed to sign in with a password. */
export const adminEmail = () => lower(process.env.ADMIN_EMAIL);

/**
 * bcrypt hash of the admin password — never the plaintext.
 *
 * Stored base64-encoded, because a raw bcrypt hash cannot survive a
 * .env file: Next.js expands `$VAR` references when it loads one, and
 * `$2b$12$…` is read as the variables $2b and $12, silently truncating
 * a 60-character hash to whatever survives. Worse, it fails ASYMMETRICALLY
 * — platform-set environment variables (Vercel) are never expanded, so
 * the raw form works in production and breaks only on a developer's
 * machine. Base64 contains no `$`, so every environment agrees.
 *
 * A value that already looks like a bcrypt hash is accepted as-is, so
 * pasting one directly still works wherever expansion is not in play.
 */
export const adminPasswordHash = (): string | null => {
  const raw = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!raw) return null;
  if (raw.startsWith("$2")) return raw;

  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    return decoded.startsWith("$2") ? decoded : null;
  } catch {
    return null;
  }
};

export function isAdminGithubLogin(githubLogin: string | null | undefined): boolean {
  const configured = adminGithubLogin();
  return configured !== null && lower(githubLogin) === configured;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const configured = adminEmail();
  return configured !== null && lower(email) === configured;
}
