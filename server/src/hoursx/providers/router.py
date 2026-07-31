"""Model routing.

Callers address models by *alias* ("deep", "fast", "embed") or explicit
``provider/model`` ref. The router resolves aliases, dispatches to the right
provider, and walks a configured fallback chain when a provider fails — so agent
profiles express intent, and vendor choice stays in configuration.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence

from hoursx.config import HoursXSettings
from hoursx.observability import get_logger
from hoursx.providers.echo import EchoProvider
from hoursx.providers.hashing import hash_embedding
from hoursx.providers.types import ChatRequest, ChatResult, ModelProvider, StreamDelta

log = get_logger("providers.router")


class ProviderError(Exception):
    """A provider failed or a ref could not be resolved."""


class _HashEmbedProvider:
    """Registry-shaped wrapper around the deterministic hashing embedder."""

    name = "hash"

    async def complete(self, request: ChatRequest) -> ChatResult:
        raise ProviderError("hash provider serves embeddings only")

    def stream(self, request: ChatRequest) -> AsyncIterator[StreamDelta]:
        raise ProviderError("hash provider serves embeddings only")

    async def embed(self, model: str, texts: Sequence[str]) -> list[list[float]]:
        return [hash_embedding(text) for text in texts]


class ModelRouter:
    """Alias resolution + provider dispatch + fallback chains."""

    def __init__(
        self,
        providers: dict[str, ModelProvider],
        aliases: dict[str, str] | None = None,
        fallbacks: dict[str, list[str]] | None = None,
    ) -> None:
        self._providers = providers
        self._aliases = dict(aliases or {})
        self._fallbacks = dict(fallbacks or {})

    def resolve(self, ref_or_alias: str) -> tuple[ModelProvider, str]:
        """Resolve an alias or ``provider/model`` ref to (provider, model)."""
        ref = self._aliases.get(ref_or_alias, ref_or_alias)
        provider_name, _, model = ref.partition("/")
        if not model:
            raise ProviderError(f"model ref {ref!r} is not of the form provider/model")
        provider = self._providers.get(provider_name)
        if provider is None:
            raise ProviderError(f"no provider registered for {provider_name!r}")
        return provider, model

    def _chain(self, ref_or_alias: str) -> list[str]:
        primary = self._aliases.get(ref_or_alias, ref_or_alias)
        return [primary, *self._fallbacks.get(ref_or_alias, [])]

    async def complete(self, ref_or_alias: str, request: ChatRequest) -> ChatResult:
        last_error: Exception | None = None
        for ref in self._chain(ref_or_alias):
            provider, model = self.resolve(ref)
            try:
                return await provider.complete(request.model_copy(update={"model": model}))
            except Exception as exc:  # noqa: BLE001 — any provider failure triggers fallback
                last_error = exc
                log.warning("provider %s failed, trying fallback", provider.name)
        raise ProviderError(f"all providers failed for {ref_or_alias!r}") from last_error

    def stream(self, ref_or_alias: str, request: ChatRequest) -> AsyncIterator[StreamDelta]:
        """Streaming does not fall back mid-stream: once bytes flow, the caller
        already consumed part of an answer. Resolution errors raise immediately."""
        provider, model = self.resolve(ref_or_alias)
        return provider.stream(request.model_copy(update={"model": model}))

    async def embed(self, texts: Sequence[str], ref_or_alias: str = "embed") -> list[list[float]]:
        provider, model = self.resolve(ref_or_alias)
        return await provider.embed(model, texts)


def build_default_router(settings: HoursXSettings) -> ModelRouter:
    """Assemble the router from configuration. Providers with no credentials are
    simply absent; the deterministic echo/hash providers are always present so a
    zero-config install still functions end to end."""
    providers: dict[str, ModelProvider] = {
        "echo": EchoProvider(),
        "hash": _HashEmbedProvider(),
    }
    if settings.anthropic_api_key:
        from hoursx.providers.anthropic import AnthropicProvider

        providers["anthropic"] = AnthropicProvider(settings.anthropic_api_key)
    if settings.openai_api_key:
        from hoursx.providers.openai_compat import OpenAICompatProvider

        providers["openai"] = OpenAICompatProvider(
            name="openai", base_url=settings.openai_base_url, api_key=settings.openai_api_key
        )
    if settings.local_base_url:
        from hoursx.providers.openai_compat import OpenAICompatProvider

        providers["local"] = OpenAICompatProvider(name="local", base_url=settings.local_base_url)
    return ModelRouter(providers, settings.model_aliases, settings.model_fallbacks)
