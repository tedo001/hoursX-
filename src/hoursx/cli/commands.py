"""Command implementations for the ``hoursx`` CLI.

Each command is a plain async function taking parsed arguments and returning a
process exit code. Keeping them free of argparse means the GUI and tests can
call the same logic without constructing a parser.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any

from sqlalchemy import select

from hoursx.cli import render
from hoursx.cli.engine import (
    LocalContext,
    close_local,
    ensure_agent,
    ensure_session,
    open_local,
    stream_run,
)
from hoursx.config import get_settings
from hoursx.db.models import AgentProfile, ApprovalRequest, Run, RunStep, Session
from hoursx.events import Event, EventType
from hoursx.system.probe import (
    kernel_facts,
    list_processes,
    loaded_modules,
    read_kernel_log,
    resource_snapshot,
)


def _emit(text: str = "") -> None:
    print(text, flush=True)


# --------------------------------------------------------------------- agent


async def cmd_agent_run(args: argparse.Namespace) -> int:
    """Run one goal to completion, streaming the agent's output live."""
    context = await open_local()
    try:
        agent_id = await ensure_agent(context, args.agent)
        session_id = await ensure_session(context, agent_id, args.goal[:60])

        streamed_any = False

        def on_event(event: Event) -> None:
            nonlocal streamed_any
            if event.type is EventType.RUN_DELTA:
                sys.stdout.write(str(event.payload.get("text", "")))
                sys.stdout.flush()
                streamed_any = True
            elif event.type is EventType.RUN_STEP and not args.quiet:
                if streamed_any:
                    _emit()
                mark = "✓" if event.payload.get("ok") else "✗"
                tool = event.payload.get("tool", "?")
                style = "green" if event.payload.get("ok") else "yellow"
                _emit(
                    render.paint(f"  {mark} {tool}", style)
                    + render.dim(f" — {event.payload.get('summary', '')}")
                )

        terminal = await stream_run(
            context, session_id=session_id, text=args.goal, on_event=on_event
        )
        if streamed_any:
            _emit()

        if terminal is None:
            _emit(render.paint("Run did not finish within the time limit.", "red"))
            return 1
        if terminal.type is EventType.RUN_AWAITING_APPROVAL:
            _emit(
                render.paint("Paused for approval: ", "yellow")
                + f"{terminal.payload.get('tool')} "
                + render.dim(json.dumps(terminal.payload.get("arguments", {})))
            )
            _emit(
                render.dim(
                    f"Approve with: hoursx approvals approve {terminal.payload.get('approval_id')}"
                )
            )
            return 2
        if terminal.payload.get("status") != "succeeded":
            _emit(render.paint(f"Failed: {terminal.payload.get('error')}", "red"))
            return 1
        return 0
    finally:
        await close_local(context)


async def cmd_agent_list(args: argparse.Namespace) -> int:
    context = await open_local()
    try:
        async with context.services.db.session() as db:
            profiles = (
                (
                    await db.execute(
                        select(AgentProfile).where(
                            AgentProfile.workspace_id == context.workspace_id
                        )
                    )
                )
                .scalars()
                .all()
            )
        rows = [
            {
                "handle": p.handle,
                "title": p.title,
                "model": p.model_alias,
                "tools": ", ".join(p.tool_grants or []),
            }
            for p in profiles
        ]
        _emit(render.table(rows, ["handle", "title", "model", "tools"]))
        return 0
    finally:
        await close_local(context)


async def cmd_agent_create(args: argparse.Namespace) -> int:
    context = await open_local()
    try:
        await ensure_agent(
            context,
            args.handle,
            title=args.title or args.handle.title(),
            instructions=args.instructions or "",
            model_alias=args.model,
            grants=args.tools.split(",") if args.tools else None,
        )
        _emit(render.paint(f"agent '{args.handle}' ready", "green"))
        return 0
    finally:
        await close_local(context)


# ---------------------------------------------------------------------- runs


async def cmd_run_list(args: argparse.Namespace) -> int:
    context = await open_local()
    try:
        async with context.services.db.session() as db:
            runs = (
                (
                    await db.execute(
                        select(Run)
                        .where(Run.workspace_id == context.workspace_id)
                        .order_by(Run.created_at.desc())
                        .limit(args.limit)
                    )
                )
                .scalars()
                .all()
            )
        rows = [
            {
                "id": run.id[:12],
                "status": run.status,
                "steps": run.step_count,
                "tokens": run.input_tokens + run.output_tokens,
                "goal": run.goal,
            }
            for run in runs
        ]
        _emit(render.table(rows, ["id", "status", "steps", "tokens", "goal"]))
        return 0
    finally:
        await close_local(context)


async def cmd_run_show(args: argparse.Namespace) -> int:
    context = await open_local()
    try:
        async with context.services.db.session() as db:
            run = await _resolve_run(db, context, args.run_id)
            if run is None:
                _emit(render.paint(f"no run matching {args.run_id!r}", "red"))
                return 1
            steps = (
                (
                    await db.execute(
                        select(RunStep).where(RunStep.run_id == run.id).order_by(RunStep.index)
                    )
                )
                .scalars()
                .all()
            )
        _emit(
            render.key_values(
                {
                    "id": run.id,
                    "status": run.status,
                    "steps": run.step_count,
                    "tokens in/out": f"{run.input_tokens}/{run.output_tokens}",
                    "goal": run.goal,
                    "answer": run.final_answer or "-",
                    "error": run.error or "-",
                }
            )
        )
        if steps:
            _emit()
            _emit(render.heading("Steps"))
            _emit(
                render.table(
                    [
                        {
                            "#": step.index,
                            "kind": step.kind,
                            "ms": step.duration_ms,
                            "detail": render.truncate(json.dumps(step.detail), 200),
                        }
                        for step in steps
                    ],
                    ["#", "kind", "ms", "detail"],
                )
            )
        return 0
    finally:
        await close_local(context)


async def cmd_run_cancel(args: argparse.Namespace) -> int:
    context = await open_local()
    try:
        async with context.services.db.session() as db:
            run = await _resolve_run(db, context, args.run_id)
        if run is None:
            _emit(render.paint(f"no run matching {args.run_id!r}", "red"))
            return 1
        accepted = await context.conductor.request_cancel(
            run_id=run.id, workspace_id=context.workspace_id
        )
        _emit(
            render.paint("cancellation requested", "yellow")
            if accepted
            else render.dim("run already finished; nothing to cancel")
        )
        return 0
    finally:
        await close_local(context)


async def _resolve_run(db: Any, context: LocalContext, prefix: str) -> Run | None:
    """Accept an id prefix so operators can paste the short id from `run list`."""
    runs = (
        (
            await db.execute(
                select(Run)
                .where(Run.workspace_id == context.workspace_id)
                .order_by(Run.created_at.desc())
                .limit(500)
            )
        )
        .scalars()
        .all()
    )
    return next((run for run in runs if run.id.startswith(prefix)), None)


# ----------------------------------------------------------------- approvals


async def cmd_approvals_list(args: argparse.Namespace) -> int:
    context = await open_local()
    try:
        async with context.services.db.session() as db:
            pending = (
                (
                    await db.execute(
                        select(ApprovalRequest).where(
                            ApprovalRequest.workspace_id == context.workspace_id,
                            ApprovalRequest.status == "pending",
                        )
                    )
                )
                .scalars()
                .all()
            )
        rows = [
            {
                "id": item.id[:12],
                "tool": item.tool_name,
                "run": item.run_id[:12],
                "arguments": json.dumps(item.arguments),
            }
            for item in pending
        ]
        _emit(render.table(rows, ["id", "tool", "run", "arguments"]))
        return 0
    finally:
        await close_local(context)


async def _decide(args: argparse.Namespace, approved: bool) -> int:
    context = await open_local()
    try:
        async with context.services.db.session() as db:
            pending = (
                (
                    await db.execute(
                        select(ApprovalRequest).where(
                            ApprovalRequest.workspace_id == context.workspace_id,
                            ApprovalRequest.status == "pending",
                        )
                    )
                )
                .scalars()
                .all()
            )
        match = next((item for item in pending if item.id.startswith(args.approval_id)), None)
        if match is None:
            _emit(render.paint(f"no pending approval matching {args.approval_id!r}", "red"))
            return 1
        await context.conductor.decide_approval(
            approval_id=match.id, decided_by=context.user_id, approved=approved
        )
        _emit(
            render.paint("approved — run resuming", "green")
            if approved
            else render.paint("denied — the agent will choose another approach", "yellow")
        )
        return 0
    finally:
        await close_local(context)


async def cmd_approvals_approve(args: argparse.Namespace) -> int:
    return await _decide(args, True)


async def cmd_approvals_deny(args: argparse.Namespace) -> int:
    return await _decide(args, False)


# ----------------------------------------------------------------- knowledge


async def cmd_knowledge_add(args: argparse.Namespace) -> int:
    from pathlib import Path

    from hoursx.db.models import Document

    source = Path(args.path)
    if not source.is_file():
        _emit(render.paint(f"{args.path} is not a readable file", "red"))
        return 1
    text = source.read_text(errors="replace")

    context = await open_local()
    try:
        async with context.services.db.session() as db:
            document = Document(
                workspace_id=context.workspace_id,
                title=args.title or source.name,
                source=str(source),
            )
            db.add(document)
            await db.flush()
            document_id = document.id
        async with context.services.db.session() as db:
            chunks = await context.services.knowledge.ingest(db, document_id=document_id, text=text)
        _emit(render.paint(f"ingested {source.name} into {chunks} chunks", "green"))
        return 0
    finally:
        await close_local(context)


async def cmd_knowledge_search(args: argparse.Namespace) -> int:
    context = await open_local()
    try:
        async with context.services.db.session() as db:
            hits = await context.services.knowledge.search(
                db, workspace_id=context.workspace_id, query=args.query, top_k=args.limit
            )
        if not hits:
            _emit(render.dim("no matches"))
            return 0
        for hit in hits:
            _emit(render.heading(f"{hit.document_title}  ") + render.dim(f"score {hit.score}"))
            _emit(render.truncate(hit.text, 400))
            _emit()
        return 0
    finally:
        await close_local(context)


# -------------------------------------------------------------------- system


async def cmd_system_probe(args: argparse.Namespace) -> int:
    """Host and kernel snapshot. Read-only; runs regardless of the ops flag,
    because an operator inspecting their own machine from their own terminal is
    not the threat the flag exists to control."""
    facts = kernel_facts()
    resources = resource_snapshot()

    _emit(render.heading("Kernel"))
    _emit(render.key_values(facts.as_dict(), indent=2))
    _emit()

    _emit(render.heading("Resources"))
    if resources.memory_total_kb:
        used_fraction = 1.0 - (resources.memory_available_kb or 0) / resources.memory_total_kb
        _emit(
            f"  memory  {render.bar(used_fraction)} "
            f"{resources.memory_used_percent}%  "
            f"of {render.bytes_human(resources.memory_total_kb * 1024)}"
        )
    if resources.load_average:
        _emit(f"  load    {', '.join(f'{v:.2f}' for v in resources.load_average)}")
    _emit(f"  procs   {resources.process_count}")
    if resources.open_file_descriptors is not None:
        _emit(f"  fds     {resources.open_file_descriptors} / {resources.file_descriptor_limit}")
    _emit()

    if resources.disks:
        _emit(render.heading("Filesystems"))
        for disk in resources.disks[:10]:
            _emit(
                f"  {disk['mountpoint'][:30].ljust(30)} "
                f"{render.bar(disk['used_percent'] / 100, 16)} "
                f"{disk['used_percent']}%  {render.bytes_human(disk['free_bytes'])} free"
            )
        _emit()

    if args.verbose:
        modules = loaded_modules()
        _emit(render.heading(f"Kernel modules ({len(modules)})"))
        _emit(
            render.table(
                [
                    {
                        "name": m["name"],
                        "size": render.bytes_human(m["size_bytes"]),
                        "used": m["use_count"],
                    }
                    for m in modules[:20]
                ],
                ["name", "size", "used"],
            )
        )
    return 0


async def cmd_system_processes(args: argparse.Namespace) -> int:
    processes = list_processes(limit=args.limit, sort_by=args.sort)
    if not processes:
        _emit(render.paint("/proc is not readable on this host", "red"))
        return 1
    _emit(
        render.table(
            [
                {
                    "pid": p["pid"],
                    "state": p["state"],
                    "rss": render.bytes_human(p["rss_kb"] * 1024),
                    "name": p["name"],
                    "cmdline": p["cmdline"],
                }
                for p in processes
            ],
            ["pid", "state", "rss", "name", "cmdline"],
        )
    )
    return 0


async def cmd_system_kernel_log(args: argparse.Namespace) -> int:
    ok, text = await read_kernel_log(args.lines)
    if not ok:
        _emit(render.paint(text, "yellow"))
        return 1
    _emit(text)
    return 0


# -------------------------------------------------------------------- doctor


async def cmd_doctor(args: argparse.Namespace) -> int:
    """Check that the deployment is coherent before something fails at runtime."""
    settings = get_settings()
    problems: list[str] = []
    warnings: list[str] = []

    _emit(render.heading("Configuration"))
    _emit(
        render.key_values(
            {
                "environment": settings.environment,
                "database": settings.database_url.split("://")[0],
                "task backend": settings.task_backend,
                "redis": "configured" if settings.redis_url else "not configured",
                "system ops": "enabled" if settings.system_ops_enabled else "disabled",
                "system mutations": "enabled" if settings.system_mutations_enabled else "disabled",
            },
            indent=2,
        )
    )
    _emit()

    if settings.jwt_secret == "dev-only-insecure-secret":
        problems.append("HOURSX_JWT_SECRET is the insecure default — set a long random value")
    if settings.task_backend == "arq" and not settings.redis_url:
        problems.append(
            "task_backend is 'arq' but HOURSX_REDIS_URL is unset; runs will not execute"
        )
    if settings.environment == "production" and settings.allow_open_registration:
        warnings.append("open registration is enabled in production")
    if settings.system_mutations_enabled and not settings.system_ops_enabled:
        warnings.append(
            "system mutations are enabled but system ops are off; the flag has no effect"
        )

    _emit(render.heading("Model providers"))
    context = await open_local(settings)
    try:
        for alias in ("fast", "deep", "embed"):
            try:
                provider, model = context.services.router.resolve(alias)
                _emit(f"  {alias.ljust(6)} {render.paint('ok', 'green')}  {provider.name}/{model}")
            except Exception as exc:  # noqa: BLE001 — resolution failure is the finding
                _emit(f"  {alias.ljust(6)} {render.paint('unresolved', 'red')}  {exc}")
                problems.append(f"model alias '{alias}' does not resolve")
        _emit()

        _emit(render.heading("Storage"))
        try:
            async with context.services.db.session() as db:
                await db.execute(select(Run).limit(1))
            _emit(f"  database {render.paint('reachable', 'green')}")
        except Exception as exc:  # noqa: BLE001
            _emit(f"  database {render.paint('unreachable', 'red')}  {exc}")
            problems.append("database is unreachable")
        _emit()
    finally:
        await close_local(context)

    for warning in warnings:
        _emit(render.paint("warn  ", "yellow") + warning)
    for problem in problems:
        _emit(render.paint("fail  ", "red") + problem)
    if not problems and not warnings:
        _emit(render.paint("All checks passed.", "green"))
    return 1 if problems else 0


# ------------------------------------------------------------------ sessions


async def cmd_session_list(args: argparse.Namespace) -> int:
    context = await open_local()
    try:
        async with context.services.db.session() as db:
            sessions = (
                (
                    await db.execute(
                        select(Session)
                        .where(Session.workspace_id == context.workspace_id)
                        .order_by(Session.created_at.desc())
                        .limit(args.limit)
                    )
                )
                .scalars()
                .all()
            )
        _emit(
            render.table(
                [
                    {
                        "id": s.id[:12],
                        "title": s.title,
                        "created": s.created_at.strftime("%Y-%m-%d %H:%M"),
                    }
                    for s in sessions
                ],
                ["id", "title", "created"],
            )
        )
        return 0
    finally:
        await close_local(context)


# ---------------------------------------------------------------------- chat


async def cmd_chat(args: argparse.Namespace) -> int:
    """Interactive REPL against one persistent session."""
    context = await open_local()
    try:
        agent_id = await ensure_agent(context, args.agent)
        session_id = await ensure_session(context, agent_id, "CLI chat")
        _emit(render.heading(f"HoursX chat — agent '{args.agent}'"))
        _emit(render.dim("Type your goal. Ctrl-D or 'exit' to leave.\n"))

        while True:
            try:
                line = input(render.paint("you › ", "cyan"))
            except (EOFError, KeyboardInterrupt):
                _emit()
                return 0
            goal = line.strip()
            if not goal:
                continue
            if goal in {"exit", "quit"}:
                return 0

            sys.stdout.write(render.paint("agent › ", "green"))
            sys.stdout.flush()

            def on_event(event: Event) -> None:
                if event.type is EventType.RUN_DELTA:
                    sys.stdout.write(str(event.payload.get("text", "")))
                    sys.stdout.flush()
                elif event.type is EventType.RUN_STEP:
                    mark = "✓" if event.payload.get("ok") else "✗"
                    sys.stdout.write(render.dim(f"\n  {mark} {event.payload.get('tool')}\n"))
                    sys.stdout.flush()

            terminal = await stream_run(
                context, session_id=session_id, text=goal, on_event=on_event
            )
            _emit()
            if terminal and terminal.type is EventType.RUN_AWAITING_APPROVAL:
                _emit(
                    render.paint("  paused for approval: ", "yellow")
                    + str(terminal.payload.get("tool"))
                )
                answer = input(render.paint("  approve? [y/N] ", "yellow")).strip().lower()
                await context.conductor.decide_approval(
                    approval_id=str(terminal.payload.get("approval_id")),
                    decided_by=context.user_id,
                    approved=answer in {"y", "yes"},
                )
                await context.conductor.wait_for_inline_runs()
                async with context.services.db.session() as db:
                    run = await db.get(Run, terminal.run_id)
                if run and run.final_answer:
                    _emit(render.paint("agent › ", "green") + run.final_answer)
            _emit()
    finally:
        await close_local(context)


# ----------------------------------------------------------------------- gui


async def cmd_gui(args: argparse.Namespace) -> int:
    from hoursx.gui.app import launch

    return launch()


def run_async(coroutine) -> int:
    """Entry helper that keeps Ctrl-C from printing a traceback."""
    try:
        return asyncio.run(coroutine)
    except KeyboardInterrupt:
        return 130
