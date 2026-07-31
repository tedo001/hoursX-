# Building a HoursX Plugin

A plugin contributes tools to the platform. This guide builds one end to end.

## The contract

A plugin is a Python module exposing `manifest()`, which returns a
`PluginManifest`: identity, version, and the tools it provides with the
permissions each needs.

```python
from pydantic import BaseModel, Field

from hoursx.sdk import PluginManifest, PluginPermission, PluginTool
from hoursx.tools.base import FunctionTool, ToolContext, ToolOutcome, ToolSpec


class ForecastArgs(BaseModel):
    """Arguments the model must supply. Field descriptions become the
    JSON-schema documentation the model actually reads — write them for it."""

    city: str = Field(description="City name, e.g. 'Lisbon'")
    days: int = Field(default=1, ge=1, le=7, description="Days ahead to forecast")


async def forecast(args: ForecastArgs, ctx: ToolContext) -> ToolOutcome:
    try:
        data = await fetch_forecast(args.city, args.days)
    except CityNotFound:
        # Failures are outcomes, not exceptions: tell the model what to do next.
        return ToolOutcome.failure(
            f"No weather station matches {args.city!r}. "
            f"Try a larger nearby city or include the country."
        )
    return ToolOutcome.success(
        f"{args.days}-day forecast for {args.city}: {data.summary}",
        high_c=data.high_c,
        low_c=data.low_c,
    )


def manifest() -> PluginManifest:
    return PluginManifest(
        name="weather",
        version="1.0.0",
        summary="Weather forecasts for any city.",
        author="you@example.com",
        tools=[
            PluginTool(
                tool=FunctionTool(
                    ToolSpec(
                        name="weather.forecast",
                        description="Get the weather forecast for a city.",
                        params_model=ForecastArgs,
                        timeout_seconds=20,
                    ),
                    forecast,
                ),
                needs=[PluginPermission.NETWORK],
            )
        ],
    )
```

## Installing

**Local directory** — drop the file into `HOURSX_PLUGIN_DIR` (default
`./plugins`) and restart. Placing the file *is* the grant: locally-installed
plugins receive every permission their manifest requests.

**Installed package** — declare an entry point and `pip install` it:

```toml
[project.entry-points."hoursx.plugins"]
weather = "hoursx_weather:manifest"
```

Restart, then confirm it loaded:

```bash
curl localhost:8400/v1/plugins -H "Authorization: Bearer $TOKEN"
```

Grant it to an agent by adding the name or a glob to `tool_grants`:

```json
{ "tool_grants": ["weather.*", "knowledge.*"] }
```

## Rules the platform enforces

| Rule | Why |
| --- | --- |
| Tool names must be namespaced (`plugin.tool`) | Prevents collisions and makes grants like `weather.*` meaningful |
| Names must be unique across all tools | A plugin cannot shadow a built-in |
| `name` is lowercase alphanumeric with hyphens; `version` is semver | Predictable identity for the marketplace index |
| Declared permissions gate registration | A tool whose needs are not granted is never registered |
| A plugin that raises during discovery is skipped | One broken plugin cannot prevent startup |

## Writing tools the model can use well

The tool description and parameter schema are the *only* things the model knows
about your tool. Treat them as product surface:

- **Describe the capability, not the implementation.** "Get the weather forecast
  for a city" — not "wraps the v3 forecast endpoint".
- **Every failure states the next move.** `ToolOutcome.failure` text is read by
  the model and is often its only chance to recover. "No weather station matches
  'Xyz'. Try a larger nearby city." beats "404 Not Found".
- **Return what the model needs next**, not a bare acknowledgment. The `summary`
  is prose for the model; `data` carries structure for both the model and the UI.
- **Bound your output.** Large payloads consume the context budget. Cap and say
  so, with a way to page through the rest.
- **Use `requires_approval=True`** for anything irreversible or externally
  visible — sending mail, spending money, deleting data.

## Using platform services

`ToolContext` carries everything a tool may touch:

```python
async def search_notes(args: NoteArgs, ctx: ToolContext) -> ToolOutcome:
    services = ctx.services
    if services is None:                       # not every context binds services
        return ToolOutcome.failure("Storage is unavailable in this context.")
    async with services.db.session() as db:
        hits = await services.knowledge.search(
            db, workspace_id=ctx.workspace_id, query=args.query
        )
    ...
```

Available fields: `workspace_id`, `session_id`, `run_id`, `sandbox_dir`,
`services` (database, router, memory, knowledge), and `delegate` when the agent
may delegate. Write files only through `sandbox_dir` — or better, reuse
`resolve_in_sandbox` from `hoursx.tools.builtin.fs`, which enforces containment.

## Testing

Test through the real executor, not by calling your function directly — that way
you also prove your schema, timeout, and grants behave:

```python
from hoursx.tools.base import ToolContext, ToolInvocation
from hoursx.tools.executor import ToolExecutor
from hoursx.tools.registry import ToolRegistry


async def test_forecast_reports_unknown_city(tmp_path):
    registry = ToolRegistry()
    for entry in manifest().tools:
        registry.register(entry.tool)
    executor = ToolExecutor(registry)
    outcome = await executor.execute(
        ToolInvocation(
            call_id="c1", tool_name="weather.forecast", arguments={"city": "Xyzzy"}
        ),
        ToolContext(workspace_id="w", session_id="s", run_id="r", sandbox_dir=tmp_path),
        grants=["weather.*"],
    )
    assert not outcome.ok
    assert "nearby city" in outcome.summary   # the guidance is the contract
```

## Publishing to a marketplace

The marketplace is a static JSON index — no server component:

```json
{
  "entries": [
    {
      "name": "weather",
      "version": "1.0.0",
      "summary": "Weather forecasts for any city.",
      "author": "you@example.com",
      "source": "hoursx-weather==1.0.0",
      "sha256": "",
      "permissions": ["network"]
    }
  ]
}
```

Host it anywhere and point `HOURSX_MARKETPLACE_INDEX_URL` at it. The index is
data: listing it never executes plugin code, and installation stays an explicit
operator action.
