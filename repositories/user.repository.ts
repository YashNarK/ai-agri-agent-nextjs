// ============================================================
// repositories/user.repository.ts
// The user store behind authentication and approval
// ============================================================

import { getPrisma } from "@/lib/prisma";

export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "approved" | "rejected";

export interface UpsertGithubUserInput {
  githubLogin: string;
  email: string | null;
  name: string | null;
  image: string | null;
  /** Create this identity as an approved admin rather than a pending user. */
  asAdmin: boolean;
}

export class UserRepository {
  async findById(id: string) {
    const prisma = await getPrisma();
    return prisma.app_users.findUnique({ where: { id } });
  }

  /**
   * Case-insensitive email lookup, matching the `LOWER(email)` unique
   * index. Prisma's `mode: "insensitive"` compiles to ILIKE, which the
   * index on LOWER(email) does not serve — comparing the lowered value
   * directly is what actually uses it.
   */
  async findByEmail(email: string) {
    const prisma = await getPrisma();
    const rows = await prisma.$queryRaw<
      { id: string }[]
    >`SELECT id FROM agricultural.app_users WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;
    if (rows.length === 0) return null;
    return this.findById(rows[0].id);
  }

  async findByGithubLogin(githubLogin: string) {
    const prisma = await getPrisma();
    const rows = await prisma.$queryRaw<
      { id: string }[]
    >`SELECT id FROM agricultural.app_users WHERE LOWER(github_login) = LOWER(${githubLogin}) LIMIT 1`;
    if (rows.length === 0) return null;
    return this.findById(rows[0].id);
  }

  /**
   * Records a GitHub sign-in, creating the user on first sight.
   *
   * An existing row's role and status are never touched here — that is
   * the admin's decision, and letting a login rewrite it would let a
   * rejected user launder themselves back to pending by signing in
   * again. Only the profile fields and last_login_at move.
   *
   * The admin is matched by GitHub login (see lib/auth/admin.ts) and is
   * created pre-approved, because there would otherwise be nobody able
   * to approve the first account.
   */
  async upsertGithubUser(input: UpsertGithubUserInput) {
    const prisma = await getPrisma();

    // Match on GitHub login first, then email: the admin may have
    // already been created by a password sign-in, in which case this is
    // the same human linking their GitHub account rather than a new one.
    const existing =
      (await this.findByGithubLogin(input.githubLogin)) ??
      (input.email ? await this.findByEmail(input.email) : null);

    if (existing) {
      return prisma.app_users.update({
        where: { id: existing.id },
        data: {
          github_login: input.githubLogin,
          email: existing.email ?? input.email,
          name: input.name ?? existing.name,
          image: input.image ?? existing.image,
          last_login_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    return prisma.app_users.create({
      data: {
        github_login: input.githubLogin,
        email: input.email,
        name: input.name,
        image: input.image,
        role: input.asAdmin ? "admin" : "user",
        status: input.asAdmin ? "approved" : "pending",
        approved_at: input.asAdmin ? new Date() : null,
        last_login_at: new Date(),
      },
    });
  }

  async touchLogin(id: string) {
    const prisma = await getPrisma();
    return prisma.app_users.update({
      where: { id },
      data: { last_login_at: new Date(), updated_at: new Date() },
    });
  }

  /** The admin's approval queue, oldest request first. */
  async listByStatus(status: UserStatus, limit = 100) {
    const prisma = await getPrisma();
    return prisma.app_users.findMany({
      where: { status },
      orderBy: { created_at: "asc" },
      take: limit,
    });
  }

  async listAll(limit = 200) {
    const prisma = await getPrisma();
    return prisma.app_users.findMany({
      orderBy: [{ status: "asc" }, { created_at: "desc" }],
      take: limit,
    });
  }

  async setStatus(id: string, status: UserStatus, approvedBy: string) {
    const prisma = await getPrisma();
    return prisma.app_users.update({
      where: { id },
      data: {
        status,
        approved_at: status === "approved" ? new Date() : null,
        approved_by: approvedBy,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Creates or updates the admin's password identity from configuration.
   * Idempotent, so it can run on every admin password sign-in attempt
   * without needing a separate bootstrap step.
   */
  async ensureAdminByEmail(email: string, passwordHash: string, name: string) {
    const prisma = await getPrisma();
    const existing = await this.findByEmail(email);

    if (existing) {
      return prisma.app_users.update({
        where: { id: existing.id },
        data: {
          password_hash: passwordHash,
          role: "admin",
          status: "approved",
          approved_at: existing.approved_at ?? new Date(),
          updated_at: new Date(),
        },
      });
    }

    return prisma.app_users.create({
      data: {
        email,
        name,
        password_hash: passwordHash,
        role: "admin",
        status: "approved",
        approved_at: new Date(),
      },
    });
  }
}
