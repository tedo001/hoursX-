# HoursX Security Model

An agent platform hands a language model real capability: a shell, a filesystem,
network access, credentials. This document states what HoursX guarantees, what it
deliberately does not, and how to configure it for an untrusted-input deployment.

## Threat model

Assumed adversaries:

1. **A confused or manipulated model.** Prompt injection through retrieved
   documents, fetched web pages, or file contents can make an agent attempt
   actions the operator never intended. This is the primary threat.
2. **An authenticated user exceeding their role.** A `member` trying to reach
   admin surface, or one workspace's user reaching another's data.
3. **An unauthenticated network attacker** reaching the API.
4. **A malicious plugin** installed by an operator.

Explicitly *not* defended against: an operator who grants an agent `shell.run`
and then runs the platform as root on the host. Capability is real, and the
sandbox is a boundary, not a vacuum.

## Identity and access

- **Passwords**: PBKDF2-HMAC-SHA256, 310,000 iterations, per-password salt. The
  iteration count is stored in each hash, so it can be raised without
  invalidating existing credentials.
- **API keys**: 256 bits of entropy, shown once, stored as an unsalted SHA-256
  (appropriate for high-entropy secrets, and it keeps lookup indexed).
- **Tokens**: HS256 JWTs with issuer and expiry validation. Set
  `HOURSX_JWT_SECRET` to a long random value in production — the default is
  intentionally labeled insecure.
- **Login responses are uniform**: a wrong password and an unknown email produce
  byte-identical `401` bodies, so the endpoint is not a user-enumeration oracle.
- **Cross-workspace requests return `404`, not `403`** — existence in another
  workspace is not disclosed.

## Role-based access control

Four ordered roles (`owner > admin > member > viewer`) map to closed permission
sets in `hoursx/auth/rbac.py`. Routes declare `require(Permission.X)`; no handler
compares role names directly, so adding a role or moving a grant is a one-file
change and cannot drift per-endpoint.

## Tool execution envelope

Every tool call passes through `ToolExecutor` in fixed order:

1. **Grant check** — the tool must match the agent's `tool_grants` globs.
   Ungranted tools are never advertised to the model, so they cannot be called
   in the first place; the runtime check is defense in depth.
2. **Schema validation** — arguments are parsed against the tool's pydantic
   model. Invalid arguments return a correction message, never a partial call.
3. **Approval gate** — tools marked `requires_approval`, or named in the
   operator's force-approval policy, suspend the run.
4. **Timeout** — per-tool or platform default; a timed-out tool is killed and
   reported.
5. **Crash isolation** — an exception inside a tool becomes a structured failure
   outcome. Stack traces and internal messages are logged, never returned to the
   model, so implementation details cannot leak into a context an attacker
   might read back.

### Filesystem sandbox

All file paths resolve through one function (`resolve_in_sandbox`) that calls
`Path.resolve()` — following symlinks — and requires the result to be the session
root or a descendant of it. Traversal (`../`), absolute paths, and symlink
escapes all raise before any I/O occurs. Tests cover each case.

Each session gets its own directory under `HOURSX_WORKSPACE_ROOT`; sessions
cannot read each other's files.

### Shell execution

`shell.run` executes with the session sandbox as its working directory. A small
deny-list blocks command classes that escape any sandbox by nature (`sudo`, `su`,
`shutdown`, `reboot`, `mkfs`, `mount`, `umount`). Output is capped and the
process is killed on timeout.

This is a **usability boundary, not a containment boundary.** A determined
command can still reach the host filesystem outside the sandbox directory. For
untrusted input, the containment must come from the container: run the worker
with a read-only root filesystem, dropped capabilities, a non-root user (the
shipped image uses UID 10001), and a network policy. The Kubernetes manifests set
`allowPrivilegeEscalation: false` and drop all capabilities by default.

If your deployment processes untrusted content, either revoke `shell.run` from
agent grants, or add it to the force-approval policy so every invocation needs a
human.

### Network tools

`http.fetch` accepts `http(s)` only and caps the response body. `browser.open`
requires the optional Playwright extra; when absent it returns actionable
guidance rather than existing as a broken tool.

Neither tool defends against SSRF on its own. In a deployment that handles
untrusted goals, put the worker behind an egress policy that blocks link-local
(`169.254.169.254`), loopback, and private RFC 1918 ranges.

## Human approval workflow

Approval is the primary control against a manipulated model. When a gated tool is
reached:

1. The executor raises `ApprovalPending` instead of executing.
2. The runtime persists the full transcript and the remaining tool calls as a
   run checkpoint, writes an `ApprovalRequest`, and moves the run to
   `awaiting_approval`.
3. An event notifies every connected operator; the console surfaces the tool name
   and its exact arguments.
4. On approval the run resumes from the checkpoint and executes that one call.
   On denial the agent is told a human declined and continues with another
   approach.

Approval is per-call, not per-session: approving one `shell.run` does not grant a
second. Decisions are idempotent and record who decided and when.

Configure the policy by passing `force_approval` to `ToolExecutor` when building
services — for example `frozenset({"shell.run", "git.commit"})`.

## Plugins

- Plugins load from installed entry points (`hoursx.plugins`) or a local
  directory the operator controls.
- A manifest declares the permissions its tools need (`network`, `filesystem`,
  `shell`, `knowledge`, `memory`); only tools whose needs are fully granted get
  registered.
- Tool names must be namespaced, and registration rejects collisions — a plugin
  cannot shadow a built-in tool.
- A plugin that raises during discovery is logged and skipped; one bad plugin
  cannot prevent startup.
- The marketplace index is inert JSON. Listing or installing never executes plugin
  code; code arrives through ordinary package installation, which remains the
  operator's decision.

**Plugins run in-process with full Python privileges.** Treat installing one
exactly like adding a dependency to your own application: review it.

## Secrets

- Credentials come from the environment via typed settings; no module reads
  `os.environ` directly.
- Secret-bearing fields are marked `repr=False`, so they cannot surface through
  an accidental settings dump.
- The JSON log formatter redacts known secret keys (`api_key`, `authorization`,
  `password`, `secret`, `token`, `jwt`) recursively.
- Secrets are never placed into model context or tool arguments by the platform.

## Data isolation

Every workspace-scoped table carries `workspace_id`, and every query filters on
the actor's workspace. Event envelopes require a workspace id at construction, so
the fanout path cannot publish to a subscriber in another tenant. Memory recall
and knowledge search are both workspace-filtered at the query level — covered by
tests that assert a foreign workspace returns nothing.

## Deployment checklist

- [ ] `HOURSX_JWT_SECRET` set to a long random value
- [ ] `HOURSX_ALLOW_OPEN_REGISTRATION=false` after the first account exists
- [ ] TLS terminated in front of the API (tokens are bearer credentials)
- [ ] CORS narrowed from the permissive default to your console origin
- [ ] Containers run as non-root with dropped capabilities
- [ ] Egress policy applied to the worker if agents fetch untrusted URLs
- [ ] `shell.run` revoked or force-approved for agents handling untrusted input
- [ ] Database and Redis reachable only from the cluster, not the public internet
- [ ] Secrets sourced from a secret manager rather than committed manifests

## Reporting a vulnerability

Please report security issues privately to the repository maintainers rather than
opening a public issue.
