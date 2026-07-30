// ============================================================
// lib/neon.ts
//
// One place that teaches the Neon driver how to open a socket.
//
// The driver talks Postgres over a WebSocket. Left to itself it looks for
// a global WebSocket, which resolves inconsistently once the module is
// bundled into the Next.js server build — the handshake then fails with
// "Received network error or non-101 status code". Handing it the `ws`
// implementation explicitly is the documented Node.js setup and removes
// the ambiguity. Paired with `serverExternalPackages` in next.config.ts
// so the driver is required natively rather than bundled.
//
// This lives in its own module because two independent consumers need it
// before their first query — the Prisma adapter and the LangGraph
// checkpointer — and an assignment that happens in only one of them is a
// bug that appears solely on whichever code path runs first.
// ============================================================

import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

/**
 * A connection pool over the Neon WebSocket transport.
 *
 * Deliberately not `pg.Pool`: node-postgres opens a plain TCP connection
 * to :5432, which is a second transport with its own reachability and
 * timeout behaviour to reason about. Neon's Pool is API-compatible, so
 * anything typed against `pg.Pool` accepts it, and the whole app then
 * talks to Postgres exactly one way.
 */
export function createNeonPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export { neonConfig };
