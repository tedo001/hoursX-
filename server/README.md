# HoursX Server

FastAPI backend for the HoursX agent platform. See the
[repository README](../README.md) for an overview and
[docs/architecture.md](../docs/architecture.md) for the design.

```bash
pip install -e ".[dev]"
hoursx db-init
hoursx serve          # http://localhost:8400 (OpenAPI at /docs)
pytest -q             # 97 tests, no external services required
```

Optional extras: `[postgres]` for asyncpg, `[browser]` for Playwright-backed
browser tools.
