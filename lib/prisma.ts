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
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

import { loadDatabaseConfig } from "@/lib/aws/app-config";
import { settings } from "@/lib/config/settings";

// The Neon driver talks Postgres over a WebSocket. Left to itself it
// looks for a global WebSocket, which resolves inconsistently once the
// module is bundled into the Next.js server build — the handshake then
// fails with "Received network error or non-101 status code". Handing it
// the `ws` implementation explicitly is the documented Node.js setup and
// removes the ambiguity. Paired with `serverExternalPackages` in
// next.config.ts so the driver is required natively rather than bundled.
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

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
