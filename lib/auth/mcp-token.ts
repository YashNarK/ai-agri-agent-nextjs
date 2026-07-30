// ============================================================
// lib/auth/mcp-token.ts
//
// Bearer-token authentication for the MCP endpoint.
//
// The MCP server exposes the same prediction and semantic-search tools
// the guarded REST routes do, so leaving it open would make those
// guards decorative — an external client could simply ask the MCP
// server to spend the Azure budget instead.
//
// Cookies are not an option here: MCP clients are other AI systems
// (Claude Desktop, agent runtimes), not browsers with a session. A
// bearer token is the shape those clients already speak.
//
// One shared token, deliberately, rather than per-user keys. Nothing in
// the MCP surface is user-scoped — the tools read reference data and
// score models, none of it filtered by identity — so per-user keys would
// add a key-management surface without changing what anyone can reach.
// When MCP grows a user-scoped tool, this becomes an app_users-backed
// API key and the callers keep the same header.
// ============================================================

import "server-only";

import { timingSafeEqual } from "node:crypto";

import { ApiError } from "@/lib/errors";

const configuredToken = () => process.env.MCP_API_TOKEN?.trim() || null;

/**
 * Constant-time comparison, so a wrong token cannot be recovered one
 * character at a time by timing the response. Lengths are compared
 * first because timingSafeEqual throws on a length mismatch — that
 * check leaks only the length, which is not the secret.
 */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Throws ApiError(401) unless the request carries the configured bearer
 * token.
 *
 * An unset MCP_API_TOKEN closes the endpoint rather than opening it.
 * The alternative — treating "no token configured" as "no auth needed" —
 * is the failure mode where a missing environment variable silently
 * publishes the thing you meant to protect.
 */
export function requireMcpToken(request: Request): void {
  const expected = configuredToken();

  if (!expected) {
    console.error(
      "[mcp] MCP_API_TOKEN is not set — refusing all MCP requests. " +
        "Set it to enable the endpoint.",
    );
    throw new ApiError(503, "MCP endpoint is not configured.");
  }

  const header = request.headers.get("authorization") ?? "";
  const [scheme, ...rest] = header.split(" ");
  const provided = rest.join(" ").trim();

  if (scheme?.toLowerCase() !== "bearer" || !provided) {
    throw new ApiError(401, "Missing bearer token.");
  }

  if (!tokensMatch(provided, expected)) {
    throw new ApiError(401, "Invalid bearer token.");
  }
}
