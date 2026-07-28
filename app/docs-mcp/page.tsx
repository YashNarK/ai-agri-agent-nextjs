// ============================================================
// app/docs-mcp/page.tsx
//
// A static, non-interactive documentation page for the MCP server's
// tools, served at /docs-mcp.
//
// The MCP server is mounted at /api/mcp and speaks the Model Context
// Protocol (JSON-RPC), so its tools are not REST endpoints and do not
// show up alongside the /api routes. This page documents them for
// humans: what each tool does, its parameters, what it returns, and
// example arguments + responses. Reference only — it executes nothing.
//
// Rendered as a server component, so the catalog never ships to the
// client. React escapes all interpolated text, which is what the
// Python version used html.escape() for.
//
// Port of routers/mcp_docs.py
// ============================================================

import type { Metadata } from "next";

import { TOOLS, type ToolDoc } from "./catalog";
import styles from "./docs.module.css";

export const metadata: Metadata = {
  title: "MCP Tools — Documentation",
  description:
    "Model Context Protocol tools exposed by the Agricultural Intelligence Platform.",
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

function ToolSection({ tool }: { tool: ToolDoc }) {
  return (
    <section id={tool.name} className={styles.tool}>
      <h2>{tool.name}</h2>
      <p className={styles.summary}>{tool.summary}</p>
      <pre className={styles.sig}>{tool.signature}</pre>
      <p>{tool.description}</p>

      <h3>Parameters</h3>
      {tool.params.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Type</th>
              <th>Required</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {tool.params.map((param) => (
              <tr key={param.name}>
                <td>
                  <code>{param.name}</code>
                </td>
                <td>
                  <code>{param.type}</code>
                </td>
                <td>{param.required ? "yes" : "no"}</td>
                <td>{param.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.muted}>No parameters.</p>
      )}

      <h3>Returns</h3>
      <p>{tool.returns}</p>

      <h3>Example — arguments</h3>
      <pre>{pretty(tool.exampleArgs)}</pre>

      <h3>Example — response</h3>
      <pre>{pretty(tool.exampleResponse)}</pre>
    </section>
  );
}

export default function McpDocsPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>MCP Tools — Documentation</h1>
        <p>
          Model Context Protocol tools exposed by this service. Reference only —
          non-interactive.
        </p>
      </header>

      <div className={styles.wrap}>
        <nav className={styles.nav}>
          <ul>
            {TOOLS.map((tool) => (
              <li key={tool.name}>
                <a href={`#${tool.name}`}>{tool.name}</a>
              </li>
            ))}
          </ul>
        </nav>

        <main className={styles.main}>
          <div className={styles.callout}>
            These tools are served by the <strong>MCP server</strong> mounted at{" "}
            <code>/api/mcp</code> and are invoked over the{" "}
            <strong>Model Context Protocol</strong> (JSON-RPC{" "}
            <code>tools/call</code>) by MCP clients — not as REST endpoints.
            Point an MCP client at <code>/api/mcp/mcp</code> for streamable HTTP
            or <code>/api/mcp/sse</code> for SSE. The REST API for direct HTTP
            access is indexed at <a href="/api">/api</a>.
          </div>

          {TOOLS.map((tool) => (
            <ToolSection key={tool.name} tool={tool} />
          ))}
        </main>
      </div>
    </div>
  );
}
