// ============================================================
// prisma.config.ts
//
// Configuration for the Prisma CLI only — the running app never reads
// this file. At runtime the connection comes from the Neon driver
// adapter in lib/prisma.ts, which resolves it from AWS Secrets Manager.
//
// The CLI is the half of Prisma that issues DDL: `migrate dev`,
// `migrate deploy`, `db push`, `db pull`. That work needs a DIRECT,
// non-pooled connection — migrations take session-level advisory locks
// and depend on session state, neither of which survives PgBouncer's
// transaction-mode pooling on Neon's -pooler host.
//
// So this points at DIRECT_URL, falling back to DATABASE_URL for setups
// that have not split the two. Note this is NOT the `directUrl`
// datasource field from older Prisma: with driver adapters, the
// schema's datasource block carries no URL at all, and prisma.config.ts
// supplies the one the CLI uses.
//
// The CLI cannot call AWS, so these must come from the environment.
// ============================================================

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
