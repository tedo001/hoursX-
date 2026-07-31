"""Health, readiness, and operational introspection."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text

from hoursx import __version__
from hoursx.api.deps import Actor, get_services, require
from hoursx.auth import Permission
from hoursx.observability import metrics
from hoursx.services import AppServices

router = APIRouter(tags=["admin"])


@router.get("/healthz")
async def healthz() -> dict:
    """Liveness: the process is up."""
    return {"ok": True, "version": __version__}


@router.get("/readyz")
async def readyz(services: AppServices = Depends(get_services)) -> dict:
    """Readiness: dependencies are reachable (database round-trip)."""
    async with services.db.session() as db:
        await db.execute(text("SELECT 1"))
    return {"ok": True}


@router.get("/v1/admin/metrics")
async def get_metrics(
    actor: Actor = Depends(require(Permission.OBSERVE)),
) -> dict:
    return {"counters": metrics.snapshot()}


@router.get("/v1/admin/tools")
async def list_tools(
    actor: Actor = Depends(require(Permission.OBSERVE)),
    services: AppServices = Depends(get_services),
) -> dict:
    return {"tools": services.registry.names()}
