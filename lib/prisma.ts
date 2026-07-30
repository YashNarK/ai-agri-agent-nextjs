// ============================================================
// lib/prisma.ts
//
// Prisma client whose connection string is resolved at runtime
// from AWS Secrets Manager (or $DATABASE_URL when set).
//
// FastAPI built the engine inside its lifespan; Next.js route
// handlers have no lifespan, so the client is built lazily behind
// a memoised promise and cached on globalThis to survive HMR in
// development (the standard Next.js Prisma singleton).
//
// Port of core/database.py
// ============================================================

import { PrismaClient } from "@/app/generated/prisma/client";
import type { PrismaClientOptions } from "@/app/generated/prisma/internal/prismaNamespace";
import { PrismaNeon } from "@prisma/adapter-neon";

import { loadDatabaseConfig } from "@/lib/aws/app-config";
import { settings } from "@/lib/config/settings";

// Importing this configures the Neon driver's WebSocket transport as a
// side effect — see lib/neon.ts for why that has to happen before the
// first query, here and in the checkpointer alike.
import "@/lib/neon";

const globalForPrisma = globalThis as typeof globalThis & {
  __prismaPromise?: Promise<PrismaClient>;
};

async function createPrismaClient(): Promise<PrismaClient> {
  const database = await loadDatabaseConfig();

  // Application traffic goes to the POOLED endpoint. Neon's pooler is
  // PgBouncer in transaction mode, which suits many short-lived CRUD
  // connections — exactly what serverless request handlers produce.
  // DDL must not come through here; see scripts/sql-runner.ts.
  const adapter = new PrismaNeon({ connectionString: database.url });

  const options: PrismaClientOptions = {
    adapter,
    log: settings.DEBUG ? ["query", "warn", "error"] : ["warn", "error"],
  };

  return new PrismaClient(options);
}

/**
 * Returns the shared PrismaClient, creating it on first use.
 * Repositories await this rather than importing a client built
 * before the DB credentials were known.
 */
export function getPrisma(): Promise<PrismaClient> {
  globalForPrisma.__prismaPromise ??= createPrismaClient().catch(
    (error: unknown) => {
      // never cache a failed connection attempt
      globalForPrisma.__prismaPromise = undefined;
      throw error;
    },
  );
  return globalForPrisma.__prismaPromise;
}

export type { PrismaClient };
