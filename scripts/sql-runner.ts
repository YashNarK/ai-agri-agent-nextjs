// ============================================================
// scripts/sql-runner.ts
//
// Executes arbitrary .sql files against the database.
//
// The DDL in sql/ predates Prisma and remains the source of truth for
// things Prisma's schema language cannot express: the `vector` and
// `uuid-ossp` extensions, the partitioned crop_price_history table, and
// the ivfflat vector indexes. Prisma introspects the result — it does
// not create it — so this runner stays the way the schema is applied.
//
// Uses the raw Neon driver rather than Prisma: these scripts contain
// multiple ';'-separated statements per file, which the simple-query
// protocol runs in one call.
//
// Credentials resolve in the same order as the app:
//   1. $DATABASE_URL
//   2. AWS Secrets Manager secret named by settings.DB_SECRET_NAME
//
// USAGE:
//   npm run sql sql                    # run every file in sql/
//   npm run sql sql/02_schema.sql ...  # run specific files
//
// Port of core/sql_runner.py
// ============================================================

import "dotenv/config";

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { Client } from "@neondatabase/serverless";

import { loadDatabaseConfig } from "../lib/aws/app-config";

async function connect(): Promise<Client> {
  const { url } = await loadDatabaseConfig();
  const client = new Client(url);
  await client.connect();
  return client;
}

/** Runs a full script (possibly many statements) in one call. */
async function runSqlScript(client: Client, sql: string): Promise<void> {
  await client.query(sql);
}

async function runSqlFile(client: Client, filePath: string): Promise<string> {
  const sql = await readFile(filePath, "utf8");
  await runSqlScript(client, sql);
  return filePath;
}

/** Runs every matching .sql file in name order (01_/02_/... prefixes). */
async function runSqlDirectory(
  client: Client,
  directory: string,
): Promise<string[]> {
  const entries = await readdir(directory);
  const files = entries
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => path.join(directory, name));

  const ran: string[] = [];
  for (const file of files) {
    ran.push(await runSqlFile(client, file));
  }
  return ran;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: npm run sql <file-or-dir> [more ...]");
    return 2;
  }

  const client = await connect();
  try {
    for (const arg of args) {
      const target = path.resolve(arg);
      const info = await stat(target);
      const ran = info.isDirectory()
        ? await runSqlDirectory(client, target)
        : [await runSqlFile(client, target)];

      for (const file of ran) {
        console.log(`ran ${path.relative(process.cwd(), file)}`);
      }
    }
  } finally {
    await client.end();
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
