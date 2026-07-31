# Operating HoursX

## Configuration

Every setting is an environment variable prefixed `HOURSX_`, read once into typed
settings at startup. `.env.example` lists the full surface; the ones that matter
most:

| Variable | Default | Notes |
| --- | --- | --- |
| `HOURSX_DATABASE_URL` | SQLite file | Use `postgresql+asyncpg://…` in production |
| `HOURSX_REDIS_URL` | unset | Required for `arq` backend and cross-replica events |
| `HOURSX_TASK_BACKEND` | `inline` | `inline` for dev; `arq` for production |
| `HOURSX_JWT_SECRET` | insecure default | **Must** be replaced in production |
| `HOURSX_ALLOW_OPEN_REGISTRATION` | `true` | Set `false` once your accounts exist |
| `HOURSX_MAX_RUN_STEPS` | `24` | Global ceiling; agent profiles may set lower |
| `HOURSX_CONTEXT_TOKEN_BUDGET` | `24000` | Hard cap on assembled context |
| `HOURSX_WORKSPACE_ROOT` | `./workspaces` | Per-session sandbox parent |
| `HOURSX_MODEL_ALIASES` | Anthropic + hash embed | JSON map of alias → `provider/model` |
| `HOURSX_MODEL_FALLBACKS` | `{}` | JSON map of alias → ordered fallback refs |

Model aliases decouple agents from vendors:

```bash
HOURSX_MODEL_ALIASES='{"fast":"anthropic/claude-haiku-4-5","deep":"anthropic/claude-sonnet-5","embed":"openai/text-embedding-3-small"}'
HOURSX_MODEL_FALLBACKS='{"deep":["openai/gpt-5.6","local/llama3"]}'
```

## Execution backends

**`inline`** executes runs as background tasks in the API process. Zero
infrastructure, ideal for development — but a restart loses in-flight runs, and
run load competes with request handling. Fine for a single operator; not for a
shared deployment.

**`arq`** enqueues runs to Redis for dedicated workers. Runs survive API
restarts, scale independently, and cannot starve the request path. The scheduler
also lives here as a once-per-minute cron job. This is the production shape, and
it is what `docker-compose.yml` and the Kubernetes manifests use.

Switching is configuration only — job bodies call the same runtime code the
inline path does, so there is no behavior that exists in only one backend.

## Running

```bash
hoursx serve        # API + WebSocket gateway
hoursx worker       # background runs, ingestion, schedules (requires Redis)
hoursx db-init      # create tables
hoursx create-user --email you@example.com --password '…' --name You
```

## Scaling

**API** is stateless — scale horizontally behind any load balancer. Event fanout
crosses replicas through Redis pub/sub, so a WebSocket client attached to one
replica still receives events produced on another. Sticky sessions are not
required.

**Workers** scale horizontally; each queued job is claimed by exactly one worker.
Size the pool by concurrent runs, not by request rate — a single run can occupy a
worker slot for minutes. `max_jobs` (default 20) bounds concurrency per worker.

**PostgreSQL** is the first thing to feel load. Memory recall and knowledge search
currently scan a workspace's rows and score in Python — correct and simple at
curated scale. If a workspace accumulates tens of thousands of chunks, move to
pgvector behind the same functions in `knowledge.py`; nothing above that layer
changes.

**Sandbox storage**: the API and workers must share `HOURSX_WORKSPACE_ROOT` if you
want files written by a run to be readable by a later run in the same session.
Compose does this with a named volume; on Kubernetes use a `ReadWriteMany` PVC.
With the default `emptyDir`, agent files are per-pod and ephemeral — runs,
messages, memory, and knowledge still persist in PostgreSQL.

## Observability

**Logs** are JSON by default (`HOURSX_LOG_JSON=false` for human-readable dev
output). Every line carries the `request_id` that also appears in the
`x-request-id` response header, so a user-reported problem maps directly to log
lines.

**Metrics** are in-process counters at `GET /v1/admin/metrics`: run outcomes by
status, model turns, tool outcomes (`ok`, `failed`, `denied`, `timeout`,
`crashed`, `invalid_args`), and approval pauses. This is a cheap always-on signal,
not a replacement for a metrics backend — scrape it or export from it as needed.

**Health**: `/healthz` is liveness (process up); `/readyz` is readiness and
round-trips the database. Use `/readyz` for load-balancer membership so a replica
with a broken database connection stops receiving traffic.

## Troubleshooting

**A run stays `queued`.** With `arq`, no worker is consuming — check that the
worker container is running and pointed at the same `HOURSX_REDIS_URL`. With
`inline`, check API logs for a dispatch-boundary exception.

**A run ends `failed` with "step limit reached".** The agent looped without
producing a final answer. Usually the instructions are too vague, or a tool it
needs is not in `tool_grants` so it keeps retrying a denied call. Inspect
`/v1/runs/{id}/steps` — the tool outcomes show exactly what it kept attempting.

**A run sits in `awaiting_approval`.** It is waiting for a human. Check
`/v1/approvals` or the console's Approvals screen. Nothing times out on its own;
this is intentional — silently proceeding without a decision would defeat the
gate.

**A document stays `pending`.** Ingestion is asynchronous. If it never settles to
`ready` or `failed`, the worker is not consuming ingestion jobs. Ingestion is
idempotent, so re-uploading is safe.

**Tools are missing from an agent.** Tool visibility is grant-driven. Compare the
agent's `tool_grants` against `GET /v1/admin/tools`. Remember the model never
sees ungranted tools, so the symptom is an agent that "doesn't know how" rather
than a permission error.

**Embeddings look poor.** The default `hash` embedding provider is deterministic
and dependency-free but not a learned model. Point the `embed` alias at a real
embedding provider for production retrieval quality.

## Backup and recovery

PostgreSQL holds everything durable: users, workspaces, agent profiles, sessions,
messages, runs and their steps, approvals, memory, documents and chunks,
schedules, plugin installs. A standard `pg_dump` is a complete backup.

Redis holds only transport state (queued jobs, pub/sub). Losing it drops queued
work — runs stay `queued` and can be resubmitted — but no durable data.

Sandbox directories hold working files, not system state. Back them up only if
agent-produced artifacts matter to you beyond the run that made them.
