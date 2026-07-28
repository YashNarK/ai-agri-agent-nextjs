# Agricultural Intelligence Platform — Next.js

Price prediction, semantic search and an AI chat agent over agricultural
commodity data. A TypeScript port of the production FastAPI service
[`agri-ai-platform`](https://github.com/YashNarK/agri-ai-platform), pointing at the **same** Neon Postgres
database, the same AWS Secrets Manager / SSM parameters, and the same Azure ML
scoring endpoint.

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

## Architecture

```
app/api/**/route.ts     HTTP layer — parse, delegate, map errors
services/               business logic (framework-free)
repositories/           data access (Prisma / raw SQL)
agents/                 LangGraph ReAct agent: state, tools, nodes, graph
lib/                    config, AWS, Prisma client, errors, schemas, container
sql/                    DDL that predates Prisma (extensions, partitions, ivfflat)
scripts/                sql-runner, embedding backfill
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
npm run db:schema        # apply sql/01..08 in order
npm run db:pull          # re-introspect Neon into prisma/schema.prisma
npm run seed:embeddings  # backfill agronomic_knowledge.embedding (idempotent)
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
| POST | `/api/predictions` | 201; 404 / 422 / 502 on failure |
| POST | `/api/search` | pgvector semantic search |
| POST | `/api/chat` | full answer, all tool calls collected |
| POST | `/api/chatstream` | SSE: `token` · `tool` · `notice` · `error` · `done` |
| GET | `/api/chat/sessions/{session_id}` | 404 if unknown |
| DELETE | `/api/chat/sessions/{session_id}` | idempotent — 200 even if already gone |
| ALL | `/api/mcp/mcp` | MCP streamable HTTP (`/api/mcp/sse` for SSE) |

Errors use the Python service's shape: `{"detail": "..."}`.

## The agent

`llm → (tools → llm)* → END`, compiled with a `MemorySaver` checkpointer keyed by
`thread_id` = session id. Two guardrails carried over verbatim:

- **Tool-call budget** (`MAX_AGENT_TOOL_CALLS = 8`) — on exhaustion the final LLM
  hop runs with tools *unbound*, so the loop provably terminates.
- **`repairToolCalls`** — DeepSeek-V3.2 on Azure emits tool-call arguments with
  trailing junk (`{"crop_code":"MAIZE"}""`). Strict `JSON.parse` throws, LangChain
  files it under `invalid_tool_calls`, and the ReAct loop stalls. We scan for the
  first balanced JSON object and promote the call back to a real one.

`MemorySaver` is in-process: conversation memory resets on restart and is not
shared across instances, matching the Python app. Swap in a Postgres
checkpointer if you need durability across deploys.

## Not ported

These stay in the Python repo — they are offline ML tooling, not app logic:

- `scripts/train_price_model.py` — scikit-learn / MLflow training. The trained
  model is already deployed to the Azure ML endpoint this service calls.
- `scripts/generate_data.py`, `seed_demo_data.py`, `load_us_south_prices.py` —
  one-off data generation against a database that is already populated.
- `mlflow-price-model/`, `azureml/` — model artifacts and deployment YAML.
- `Dockerfile` — no containerization by design.
