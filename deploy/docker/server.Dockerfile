# HoursX server image — serves both the API (`hoursx serve`) and the
# background worker (`hoursx worker`); the command selects the role.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

COPY server/pyproject.toml ./server/pyproject.toml
COPY server/src ./server/src
RUN pip install --no-cache-dir "./server[postgres]"

# Unprivileged runtime user; the sandbox root must be writable by it.
RUN useradd --create-home --uid 10001 hoursx \
    && mkdir -p /app/workspaces /app/plugins \
    && chown -R hoursx:hoursx /app
USER hoursx

ENV HOURSX_WORKSPACE_ROOT=/app/workspaces \
    HOURSX_PLUGIN_DIR=/app/plugins \
    HOURSX_HOST=0.0.0.0 \
    HOURSX_PORT=8400

EXPOSE 8400

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8400/healthz || exit 1

CMD ["hoursx", "serve"]
