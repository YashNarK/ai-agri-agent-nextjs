// ============================================================
// app/page.tsx
// Service index — the human-facing counterpart to GET /api.
//
// Port of main.py's `home()` handler.
// ============================================================

import { settings } from "@/lib/config/settings";

const ENDPOINTS: { method: string; path: string; description: string }[] = [
  { method: "GET", path: "/api/crops", description: "Full crop catalog" },
  {
    method: "GET",
    path: "/api/crops/{crop_code}",
    description: "A single crop by code",
  },
  { method: "GET", path: "/api/regions", description: "All regions" },
  {
    method: "GET",
    path: "/api/regions/{region_code}",
    description: "A single region by code",
  },
  {
    method: "GET",
    path: "/api/prices/{crop_code}/{region_code}",
    description: "Historical prices (USD/tonne)",
  },
  {
    method: "POST",
    path: "/api/predictions",
    description: "ML price forecast with confidence interval",
  },
  {
    method: "POST",
    path: "/api/search",
    description: "Semantic search over the agronomic knowledge base",
  },
  {
    method: "POST",
    path: "/api/chat",
    description: "LangGraph agent — full answer in one response",
  },
  {
    method: "POST",
    path: "/api/chatstream",
    description: "LangGraph agent — token stream over SSE",
  },
  {
    method: "GET",
    path: "/api/chat/sessions/{session_id}",
    description: "Fetch a chat session",
  },
  {
    method: "DELETE",
    path: "/api/chat/sessions/{session_id}",
    description: "Delete a session and its messages",
  },
  {
    method: "ALL",
    path: "/api/mcp/mcp",
    description: "MCP server (streamable HTTP)",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-100">
      <header className="bg-emerald-800 px-6 py-8 text-white sm:px-10">
        <h1 className="text-2xl font-semibold">{settings.APP_NAME}</h1>
        <p className="mt-1 text-sm text-emerald-100">
          Price Prediction, Semantic Search and AI Chat · v{settings.APP_VERSION}
        </p>
      </header>

      <main className="mx-auto w-full max-w-4xl px-6 py-10 sm:px-10">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A JSON API. Point a client at the routes below, or read the{" "}
          <a
            className="text-emerald-700 underline dark:text-emerald-400"
            href="/docs-mcp"
          >
            MCP tools documentation
          </a>
          . The machine-readable index lives at{" "}
          <a
            className="text-emerald-700 underline dark:text-emerald-400"
            href="/api"
          >
            /api
          </a>
          .
        </p>

        <div className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Method</th>
                <th className="px-4 py-3 font-semibold">Path</th>
                <th className="px-4 py-3 font-semibold">Description</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((endpoint) => (
                <tr
                  key={`${endpoint.method} ${endpoint.path}`}
                  className="border-t border-zinc-200 dark:border-zinc-800"
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                    {endpoint.method}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                    {endpoint.path}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {endpoint.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
