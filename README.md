# Agricultural Intelligence Platform — Next.js

Price prediction, semantic search and an AI chat agent over agricultural
commodity data. A TypeScript port of the production FastAPI service
[`agri-ai-platform`](https://github.com/YashNarK/agri-ai-platform), pointing at the **same** Neon Postgres
database, the same AWS Secrets Manager / SSM parameters, and the same Azure ML
scoring endpoint.

The port is no longer only an API. The Python service was headless; this one
carries a dashboard on top of the same services — price explorer, forecasts,
knowledge search and a chat assistant — so the endpoints below have a first
consumer that ships with them. `/` redirects to `/dashboard`; the endpoint index
lives at `/docs`, where FastAPI puts its own.

## Stack mapping

| Python service            | This service                          |
| ------------------------- | ------------------------------------- |
| FastAPI routers           | Next.js App Router `app/api/**/route.ts` |
| SQLAlchemy async ORM      | Prisma 7 + `@prisma/adapter-neon`     |
| Pydantic schemas          | zod (requests) + TS interfaces (responses) |
| `HTTPException`           | `ApiError` + `toErrorResponse`        |
| `Depends()` DI            | `lib/container.ts` composition root   |
| lifespan startup          | memoised lazy loaders                 |
| FastMCP (`/mcp`)          | `mcp-handler` (`/api/mcp/[transport]`) |
| LangGraph (Python)        | LangGraph JS                          |
| `sse-starlette`           | `ReadableStream` + SSE headers        |
| Neon Postgres             | Neon Postgres (unchanged)             |
| Secrets Manager + SSM     | Secrets Manager + SSM (unchanged)     |
| `/docs` (Swagger UI)      | `app/docs/page.tsx` (static index)    |
| `routers/mcp_docs.py`     | `app/docs-mcp/page.tsx`               |
| — (no UI)                 | App Router dashboard, shadcn/ui, D3   |

## Architecture

```
app/api/**/route.ts     HTTP layer — parse, delegate, map errors
app/dashboard/**        the web app (Server Components; state lives in the URL)
app/docs, app/docs-mcp  endpoint index and MCP tool catalog, for humans
components/charts/      D3 scales + React rendering, no chart library
components/chat/        CopilotKit surface, tool renderers, artifact cards
components/ui/          shadcn/ui primitives
services/               business logic (framework-free)
repositories/           data access (Prisma / raw SQL)
agents/                 LangGraph ReAct agent: state, tools, nodes, graph,
                        plus the AG-UI bridge and tool artifacts
lib/                    config, AWS, Prisma client, errors, schemas, auth,
                        server-side fetchers (lib/api.ts), container
sql/                    DDL that predates Prisma (extensions, partitions, ivfflat)
scripts/                sql-runner, embedding backfill, password hasher
```

### Why there is no lifespan

FastAPI resolved config, the DB engine and the compiled agent graph once at
startup and hung them on `app.state`. Route handlers have no equivalent hook, so
each of those is a **memoised promise** resolved on first use and reused for the
process lifetime:

- `loadAppConfig()` — `lib/aws/app-config.ts`
- `getPrisma()` — `lib/prisma.ts`
- `getAgentGraph()` — `agents/graph.ts`

A rejected load is never cached, so a transient AWS blip does not poison the
process.

### pgvector and Prisma

`agronomic_knowledge.embedding` is `Unsupported("vector")` — Prisma cannot read,
write or filter it. All similarity search therefore goes through
`$queryRawUnsafe` with bound parameters and the `<=>` cosine-distance operator
(`repositories/knowledge.repository.ts`), and the embedding backfill writes via
`$executeRawUnsafe`. This mirrors the Python app, which used raw SQL through
SQLAlchemy for the same reason.

## Configuration

Only AWS credentials belong in `.env` — see `.env.example`. Everything else
resolves at runtime:

- **Secrets Manager** — `prod/agri/database`, `prod/agri/azure-openai`,
  `prod/agri/azure-ml`
- **SSM Parameter Store** — `/prod/agri/{embed,chat}-model-name`,
  `/prod/agri/{embed,chat}-api-version`, `/prod/agri/db-schema`

On AWS compute, drop the keys and use an IAM role.

### Pooled vs direct connections

Neon exposes two endpoints and they are **not** interchangeable. The DB secret
carries both (`database_url`, `direct_database_url`), and each is used for
exactly one job:

| Endpoint | Host | Used by | Why |
| --- | --- | --- | --- |
| Pooled | `ep-*-pooler.…` | the app (`lib/prisma.ts`) | PgBouncer in transaction mode suits many short request-scoped connections |
| Direct | `ep-*.…` | Prisma CLI (`prisma.config.ts`), `scripts/sql-runner.ts` | DDL takes session advisory locks and runs multi-statement scripts, neither of which survives transaction pooling |

Note this is *not* the `url` + `directUrl` datasource pair from older Prisma.
With driver adapters the schema's datasource block carries no URL at all: the
adapter supplies the runtime connection and `prisma.config.ts` supplies the
CLI's. `prisma.config.ts` therefore reads `DIRECT_URL`.

`DATABASE_URL` / `DIRECT_URL` are optional at runtime (they short-circuit the
AWS lookup) but **required** for the Prisma CLI, which cannot call AWS. Secrets
that predate the split still work — a single URL is used for both roles.

## Running

```bash
npm install
npm run dev            # http://localhost:3000
npm run build
npm run typecheck
```

Schema and data tooling:

```bash
npm run db:schema        # apply sql/01..09 in order
npm run db:pull          # re-introspect Neon into prisma/schema.prisma
npm run seed:embeddings  # backfill agronomic_knowledge.embedding (idempotent)
npm run hash:password -- '<password>'   # base64 bcrypt hash for ADMIN_PASSWORD_HASH
```

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api` | service index |
| GET | `/api/crops` | full catalog, ordered by name |
| GET | `/api/crops/{crop_code}` | 404 if unknown |
| GET | `/api/regions` | ordered by name |
| GET | `/api/regions/{region_code}` | 404 if unknown |
| GET | `/api/prices/{crop_code}/{region_code}` | `date_from`, `date_to`, `limit` (1–500) |
| GET | `/api/prices/pairs` | the (crop, region) pairs that actually have history |
| GET | `/api/weather/{region_code}` | daily observations; `date_from`, `date_to`, `limit` (1–2000) |
| GET | `/api/yields/{crop_code}` | `region_code`, `year_from`, `year_to` |
| GET | `/api/indicators` | macro series; `names`, `date_from`, `date_to`, `limit` |
| GET | `/api/products` | `crop_code`, `category`, `search`, `limit`; returns `categories` too |
| POST | `/api/predictions` | 201; 404 / 422 / 502 on failure |
| POST | `/api/search` | pgvector semantic search |
| POST | `/api/chat` | full answer, all tool calls collected |
| POST | `/api/chatstream` | SSE: `token` · `tool` · `notice` · `error` · `done` |
| GET | `/api/chat/sessions/{session_id}` | 404 if unknown *or* not yours |
| GET | `/api/chat/sessions/{session_id}/messages` | transcript, oldest first; empty list for a fresh thread |
| DELETE | `/api/chat/sessions/{session_id}` | idempotent — 200 even if already gone |
| ALL | `/api/copilotkit/*` | CopilotKit v2 runtime — the chat UI's real transport |
| ALL | `/api/mcp/mcp` | MCP streamable HTTP (`/api/mcp/sse` for SSE) |

Errors use the Python service's shape: `{"detail": "..."}`.

The read endpoints beyond the original port (`pairs`, `weather`, `yields`,
`indicators`, `products`) exist because the dashboard needs them; `pairs` in
particular was already written for the agent, where it stops the model inventing
crop/region codes, and the UI uses it to disable picker combinations that would
draw an empty chart.

`/api/chat` and `/api/chatstream` are the ported Python surface and still work,
but the assistant page does not use them — it talks to `/api/copilotkit/*`. Both
paths run the same compiled graph against the same checkpointer.

## The web app

| Route | What it is |
| --- | --- |
| `/dashboard` | coverage tiles and macro indicators as small multiples |
| `/dashboard/prices` | price history, seasonality heatmap, crop correlation matrix |
| `/dashboard/crops`, `/dashboard/crops/{code}` | catalog grouped by category; per-crop detail with yields |
| `/dashboard/regions`, `/dashboard/regions/{code}` | region map; per-region detail with weather |
| `/dashboard/forecasts` | run an Azure ML prediction, then inspect the feature row behind it |
| `/dashboard/knowledge` | semantic search over the agronomic knowledge base |
| `/dashboard/assistant` | the chat agent, with a per-user conversation switcher |
| `/dashboard/admin/users` | the approval queue |
| `/docs`, `/docs-mcp` | endpoint index and MCP tool catalog |

Three conventions hold across the pages:

- **Server Components by default.** Pages fetch through `lib/api.ts` on the
  server and ship data-ready HTML; the client bundle carries only pickers and
  chart interaction layers.
- **State lives in the URL.** Selected crop/region, search query and chat thread
  are query params, not component state — so every view is linkable, the back
  button works, and a reload restores what you were looking at.
- **Charts are D3 scales, React rendering.** `components/charts/` uses
  `d3-scale`/`d3-shape` for the maths and JSX for the marks; no charting library
  owns the DOM.

### Generative UI in the transcript

The agent's tools return prose — the model reads those strings, and that wording
is production-proven, so it must not change. But prose is useless to a chart.
LangChain's `content_and_artifact` format solves it: a tool returns
`[content, artifact]`, the model still sees only `content`, and the typed
artifact rides along on the `ToolMessage` (`agents/artifacts.ts`). The AG-UI
bridge puts each artifact into agent state keyed by tool-call id, and
`components/chat/tool-renderers.tsx` looks itself up by that id to draw a chart
instead of a paragraph. Where no artifact exists — an error, a no-data path, a
tool still running — the prose is shown, which is always truthful because it is
exactly what the model was told.

`agents/agui-agent.ts` is hand-written rather than using `@ag-ui/langgraph`:
that package drives a *hosted* LangGraph Platform deployment over HTTP, and our
graph is compiled inside this Next.js process. Subclassing `AbstractAgent` keeps
the call in-process, with no second copy of the agent.

## The agent

`llm → (tools → llm)* → END`, compiled with a `PostgresSaver` checkpointer keyed by
`thread_id` = session id. Two guardrails carried over verbatim:

- **Tool-call budget** (`MAX_AGENT_TOOL_CALLS = 8`) — on exhaustion the final LLM
  hop runs with tools *unbound*, so the loop provably terminates.
- **`repairToolCalls`** — DeepSeek-V3.2 on Azure emits tool-call arguments with
  trailing junk (`{"crop_code":"MAIZE"}""`). Strict `JSON.parse` throws, LangChain
  files it under `invalid_tool_calls`, and the ReAct loop stalls. We scan for the
  first balanced JSON object and promote the call back to a real one.

Conversation memory lives in Postgres, in LangGraph's own `checkpoints*` tables
(default schema, not `agricultural` — they are the library's infrastructure, not
domain data). `.setup()` creates them on first use, once per process. This
replaced the Python app's in-process `MemorySaver`, which on Vercel meant every
Lambda instance held its own memory and a conversation resumed on a different
instance found none.

The assistant's thread id lives in the URL (`/dashboard/assistant?thread=<uuid>`)
and is simultaneously the LangGraph `thread_id` and the `chat_sessions` row id.
Because it is in the URL rather than component state, a conversation survives
navigation, reload and back/forward; `GET /api/chat/sessions/:id/messages`
restores the visible transcript after a reload, while the checkpointer restores
what the agent actually remembers.

One thing that is deliberately NOT preserved: an answer still streaming when you
navigate away. The run is driven by the browser's connection, so unmounting the
chat unsubscribes the AG-UI observable and `AgriculturalAgent.run` aborts the
graph — abandoned runs stop costing Azure calls, but the turn is destroyed, not
backgrounded. Nothing is persisted (`persistStreamedTurn` is skipped on an abort)
and there is no checkpoint to resume from either: LangGraph checkpoints at
superstep boundaries, and streamed tokens come from a node that has not returned.

Until that is fixed properly — durable delta buffer, resumable stream keyed by
run id — `components/chat/run-navigation-guard.tsx` holds the user on the page
while a run is in flight: `beforeunload` for tab close and reload, a capture-phase
link interceptor offering "Leave anyway", and a sentinel history entry re-pushed
on `popstate` for the back button and phone back-swipe. It is a stopgap, and the
comment at the top of that file says so.

## Identity and access

Two independent gates, because they answer different questions:

- **Authentication** — GitHub OAuth for everyone; an email/password provider
  that only the configured admin can use. Auth.js v5, JWT sessions, no database
  adapter (the credentials provider forces the JWT strategy, and this app's
  Prisma client cannot exist at module load anyway — its connection string
  arrives from Secrets Manager at runtime).
- **Authorisation** — every account is created `pending` in `app_users` and can
  reach nothing that spends money until the admin approves it at
  `/dashboard/admin/users`.

Signing in while unapproved succeeds and lands on `/pending-approval`. That is
deliberate: refusing at the door shows a generic login error, which reads as a
broken account rather than a waiting one.

**Guarded** (these call Azure OpenAI or Azure ML): `/dashboard/assistant`,
`/dashboard/knowledge`, `/dashboard/forecasts` and `/dashboard/admin/*`;
`/api/chat`, `/api/chatstream`, `/api/chat/sessions/*`, `/api/copilotkit/*`,
`/api/search`, `/api/predictions`. **Public**: the rest of the dashboard and the
plain read endpoints over our own database.

The nav marks that boundary rather than hiding it — the three model-backed links
sit in one framed group (`components/site-nav.tsx`), so the set a user sees
highlighted is the set the guards protect.

`/api/mcp/*` is guarded too, by a bearer token (`$MCP_API_TOKEN`) rather than a
cookie — its clients are other AI systems, not browsers. It exposes the same
prediction and search tools as the REST routes, so leaving it open would have
made the other guards decorative. **An unset token closes the endpoint** rather
than opening it.

`proxy.ts` (not `middleware.ts` — renamed in Next 16) only redirects browsers
that have no session cookie. It is a convenience, not a boundary: the real
checks are in `lib/auth/guard.ts`, close to the data.

Role and status are re-read from the database when a token's copy is over a
minute old, so approving or revoking someone takes effect without them signing
out. The cost of that design is a window of up to 60 seconds where a revoked
user still has access.

Two configuration notes that will bite otherwise:

- `ADMIN_PASSWORD_HASH` is stored **base64-encoded**. Next.js expands `$VAR` in
  `.env` files, and a raw bcrypt hash (`$2b$12$…`) is silently truncated — but
  only locally, since platform-set variables on Vercel are never expanded. Use
  `npm run hash:password -- '<password>'`, which emits the encoded form.
- The admin is matched from configuration (`ADMIN_GITHUB_LOGIN`, `ADMIN_EMAIL`),
  not a database flag, because the first admin cannot come from an approval
  queue that only an admin can service.

## Not ported

These stay in the Python repo — they are offline ML tooling, not app logic:

- `scripts/train_price_model.py` — scikit-learn / MLflow training. The trained
  model is already deployed to the Azure ML endpoint this service calls.
- `scripts/generate_data.py`, `seed_demo_data.py`, `load_us_south_prices.py` —
  one-off data generation against a database that is already populated.
- `mlflow-price-model/`, `azureml/` — model artifacts and deployment YAML.
- `Dockerfile` — no containerization by design.
