# HoursX API Reference

Base URL: `http://localhost:8400` (configurable). Interactive OpenAPI docs are
served at `/docs`; this page covers the contract and the parts a schema cannot
express.

## Authentication

Two credential types, both resolving to a user plus a workspace role:

**Bearer token** (humans, console):

```http
Authorization: Bearer <access_token>
```

**API key** (machines, integrations):

```http
X-API-Key: hx_<key>
```

Requests default to the caller's first workspace. Send `X-Workspace-Id: <id>` to
target a specific one.

```bash
# Register (the first account on a fresh install always succeeds)
curl -X POST localhost:8400/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"a-long-password","display_name":"You"}'
# → {"access_token":"...","user_id":"...","workspace_id":"..."}
```

Tokens are HS256 JWTs valid for `HOURSX_JWT_TTL_SECONDS` (12h default).

## Permissions

Every route declares the permission it needs. Roles map to permission sets:

| Permission | viewer | member | admin | owner |
| --- | :-: | :-: | :-: | :-: |
| `observe`, `knowledge.read` | ✅ | ✅ | ✅ | ✅ |
| `sessions.use`, `knowledge.write` | | ✅ | ✅ | ✅ |
| `agents.manage`, `runs.approve`, `schedules.manage`, `plugins.manage`, `members.manage` | | | ✅ | ✅ |
| `workspace.manage` | | | | ✅ |

A request lacking the permission gets `403` with the required permission named.

## Endpoints

### Auth

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `POST` | `/v1/auth/register` | — | Creates user + personal workspace (owner) |
| `POST` | `/v1/auth/login` | — | Same `401` body for bad email or bad password |
| `GET` | `/v1/auth/me` | authenticated | Current user |

### Agents

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/v1/agents` | `sessions.use` |
| `POST` | `/v1/agents` | `agents.manage` |
| `PUT` | `/v1/agents/{id}` | `agents.manage` |
| `DELETE` | `/v1/agents/{id}` | `agents.manage` |

```json
{
  "handle": "researcher",
  "title": "Research Agent",
  "instructions": "Cite sources. Prefer primary documents.",
  "model_alias": "deep",
  "tool_grants": ["knowledge.*", "http.fetch", "memory.*"],
  "can_delegate": false,
  "max_steps": 30
}
```

`tool_grants` are fnmatch globs. A tool outside the grants is never advertised to
the model — denial is by omission, not by runtime error.

### Sessions and messages

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/v1/sessions` | `sessions.use` |
| `POST` | `/v1/sessions` | `sessions.use` |
| `GET` | `/v1/sessions/{id}/messages` | `sessions.use` |
| `POST` | `/v1/sessions/{id}/messages` | `sessions.use` |

Submitting a message returns `202 {"run_id": "..."}` immediately — execution is
asynchronous. Set `"plan_first": true` to have the planner decompose the goal
into steps before execution begins.

### Runs

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/v1/runs/{id}` | `sessions.use` |
| `GET` | `/v1/runs/{id}/steps` | `sessions.use` |
| `GET` | `/v1/runs/{id}/stream` | `sessions.use` |

Run status is a closed set:

```
queued → running → succeeded | failed | cancelled
             ↕
      awaiting_approval
```

A run always reaches a terminal state with either `final_answer` or `error`
populated — it never ends silently.

`/stream` is Server-Sent Events. If the run already finished, it replays the
terminal event and closes, so a late subscriber still gets a definitive outcome.

```
event: run.delta
data: {"text": "Looking at the repository"}

event: run.step
data: {"tool": "fs.read", "ok": true, "summary": "Read 812 chars from README.md"}

event: run.finished
data: {"status": "succeeded", "answer": "...", "error": null}
```

### Approvals

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/v1/approvals` | `runs.approve` |
| `POST` | `/v1/approvals/{id}/decision` | `runs.approve` |

```json
{ "approved": true }
```

Decisions are idempotent: a second decision on a settled approval is a no-op.
Denial is not a failure — the agent receives a message saying the operator
declined and continues with another approach.

### Knowledge

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/v1/knowledge/documents` | `knowledge.read` |
| `POST` | `/v1/knowledge/documents` | `knowledge.write` |
| `GET` | `/v1/knowledge/search?q=` | `knowledge.read` |

Upload returns `202` with the document in `pending`. Ingestion runs
asynchronously and always settles the row to `ready` or `failed`, announcing
`document.ingested` either way.

### Schedules

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/v1/schedules` | `schedules.manage` |
| `POST` | `/v1/schedules` | `schedules.manage` |
| `DELETE` | `/v1/schedules/{id}` | `schedules.manage` |

Five-field cron, evaluated in UTC. Invalid expressions are rejected at creation
(`422`) rather than failing silently at fire time. Each firing creates a fresh
session so scheduled work never pollutes an interactive conversation.

### Plugins and admin

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/v1/plugins` | `observe` |
| `GET` | `/v1/plugins/marketplace` | `plugins.manage` |
| `GET` | `/v1/admin/tools` | `observe` |
| `GET` | `/v1/admin/metrics` | `observe` |
| `GET` | `/healthz` | — |
| `GET` | `/readyz` | — |

`/healthz` is liveness (process up). `/readyz` is readiness — it round-trips the
database.

## WebSocket events

```
ws://localhost:8400/ws?token=<access_token>
```

Browsers cannot set headers on a WebSocket handshake, so the token goes in the
query string. The socket delivers every event for the caller's workspace as JSON
frames. Send `{"type":"ping"}` to receive `{"type":"pong"}`.

Event envelope:

```json
{
  "type": "run.delta",
  "workspace_id": "...",
  "session_id": "...",
  "run_id": "...",
  "payload": { "text": "…" },
  "at": 1774915200.42
}
```

Event types: `run.started`, `run.delta`, `run.step`, `run.awaiting_approval`,
`run.finished`, `approval.decided`, `document.ingested`, `schedule.fired`.

Events are scoped to one workspace at publish time; fanout cannot cross tenants.
Across multiple API replicas, delivery rides Redis pub/sub, so a client connected
to any replica receives events produced by any other.

## Errors

Errors use the FastAPI shape:

```json
{ "detail": "requires permission agents.manage" }
```

| Status | Meaning |
| --- | --- |
| `401` | Missing, malformed, or expired credentials |
| `403` | Authenticated but the role lacks the permission |
| `404` | Not found, **or** exists in another workspace (deliberately indistinguishable) |
| `409` | Conflict (duplicate email, duplicate agent handle) |
| `422` | Request body or parameter failed validation |

Every response carries `x-request-id`, which also appears in structured logs —
quote it when reporting a problem.
