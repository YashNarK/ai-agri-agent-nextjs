// ============================================================
// types/next-auth.d.ts
//
// Module augmentation for the fields auth.ts puts on the token and the
// session. Without these, `session.user.role` is a type error and
// `token.status` is silently `any`.
// ============================================================

import type { DefaultSession } from "next-auth";

import type { UserRole, UserStatus } from "@/repositories/user.repository";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      status: UserStatus;
    } & DefaultSession["user"];
  }
}

// Augmenting "@auth/core/jwt", NOT "next-auth/jwt": the latter is a bare
// `export * from "@auth/core/jwt"`, so declarations merged into it never
// reach the JWT interface the callbacks are actually typed against.
declare module "@auth/core/jwt" {
  interface JWT {
    /** app_users.id — the identifier every other table joins against. */
    uid?: string;
    role?: UserRole;
    status?: UserStatus;
    /** When role/status were last read from the database (epoch ms). */
    checkedAt?: number;
  }
}
