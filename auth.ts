// ============================================================
// auth.ts
//
// Auth.js v5 configuration. Two providers, one user store.
//
// NO DATABASE ADAPTER, deliberately. The credentials provider requires
// the JWT session strategy, and JWT sessions do not use an adapter — so
// the user store is our own app_users table, reached through the same
// async getPrisma() every other repository uses. That sidesteps the fact
// that this app's Prisma client cannot exist at module load: its
// connection string comes from AWS Secrets Manager at runtime, which no
// adapter's constructor could have waited for.
//
// GitHub is the only way a normal user gets in. The password provider
// exists solely for the admin, and enforces that against configuration
// rather than data: the address must equal $ADMIN_EMAIL and the password
// must match $ADMIN_PASSWORD_HASH. Neither lives in a table, so database
// access alone cannot mint an admin.
//
// Signing in is NOT the same as being allowed to spend money here.
// Every account starts 'pending'; lib/auth/guard.ts is what actually
// gates the Azure-backed routes.
// ============================================================

import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";

import {
  adminPasswordHash,
  isAdminEmail,
  isAdminGithubLogin,
} from "@/lib/auth/admin";
import { userRepo } from "@/lib/container";
import type { UserRole, UserStatus } from "@/repositories/user.repository";

/**
 * How long a token's cached role/status is trusted before it is re-read
 * from the database.
 *
 * A pure JWT would carry 'pending' until it expired, so approving
 * someone would appear to do nothing until they logged out and back in
 * — and, worse, revoking someone would leave them spending for the rest
 * of the token's life. One read per user per minute buys correctness
 * that matters in both directions.
 */
const STATUS_REFRESH_MS = 60_000;

/** The GitHub profile fields we actually use. */
interface GithubProfile {
  login?: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    GitHub({
      // The default scope already includes the public profile; email is
      // requested so an account with a private email still gives us one
      // to match the admin against.
      authorization: { params: { scope: "read:user user:email" } },
    }),

    Credentials({
      name: "Admin password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        // Gate 1: only the configured admin address may use a password
        // at all. A normal user reaching this provider is rejected
        // before any hashing work happens.
        if (!isAdminEmail(email)) return null;

        const hash = adminPasswordHash();
        if (!hash) {
          console.error(
            "[auth] ADMIN_PASSWORD_HASH is not set — password sign-in is disabled.",
          );
          return null;
        }

        if (!(await bcrypt.compare(password, hash))) return null;

        // Materialise (or refresh) the admin row now that the password
        // is proven. Idempotent, so there is no separate bootstrap step
        // to remember to run.
        const user = await userRepo.ensureAdminByEmail(email, hash, "Admin");

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * Sign-in is allowed even for unapproved accounts.
     *
     * Blocking here would bounce a waiting user back to the login page
     * with a generic error, which reads as "your login is broken"
     * rather than "you are waiting for approval". They are let in, and
     * the guard sends them to /pending-approval where the state is
     * explained.
     */
    async signIn({ account, profile }) {
      if (account?.provider !== "github") return true;

      const github = profile as GithubProfile | undefined;
      const login = github?.login;
      if (!login) {
        console.error("[auth] GitHub profile had no login; refusing sign-in.");
        return false;
      }

      await userRepo.upsertGithubUser({
        githubLogin: login,
        email: github?.email ?? null,
        name: github?.name ?? null,
        image: github?.avatar_url ?? null,
        asAdmin: isAdminGithubLogin(login),
      });

      return true;
    },

    async jwt({ token, account, profile, user }) {
      // Fresh sign-in: resolve the app_users row this identity maps to.
      if (account) {
        const record =
          account.provider === "github"
            ? await userRepo.findByGithubLogin(
                (profile as GithubProfile | undefined)?.login ?? "",
              )
            : user?.id
              ? await userRepo.findById(user.id)
              : null;

        if (!record) {
          // No row means the upsert above failed. Returning a token
          // without a uid would create a session the guard cannot
          // resolve, so fail loudly instead of silently half-signing-in.
          console.error("[auth] no app_users row for a completed sign-in.");
          return null;
        }

        token.uid = record.id;
        token.role = record.role as UserRole;
        token.status = record.status as UserStatus;
        token.checkedAt = Date.now();
        return token;
      }

      // Subsequent requests: re-read role and status periodically so
      // approvals and revocations take effect without a re-login.
      const checkedAt = typeof token.checkedAt === "number" ? token.checkedAt : 0;
      if (token.uid && Date.now() - checkedAt > STATUS_REFRESH_MS) {
        const record = await userRepo.findById(token.uid);
        if (!record) return null; // deleted user → invalidate the session
        token.role = record.role as UserRole;
        token.status = record.status as UserStatus;
        token.checkedAt = Date.now();
      }

      return token;
    },

    session({ session, token }) {
      if (token.uid) session.user.id = token.uid;
      session.user.role = token.role ?? "user";
      session.user.status = token.status ?? "pending";
      return session;
    },
  },
});
