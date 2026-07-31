"""Knowledge engine (RAG): chunking, ingestion, and retrieval.

Ingestion: text → overlapping character chunks → embeddings → ``document_chunks``.
Retrieval: cosine similarity plus a small keyword-overlap bonus (helps exact
identifiers, which pure embeddings miss). Storage sits behind this module's
functions only, so replacing the scan with pgvector is a local change.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from hoursx.db.models import Document, DocumentChunk
from hoursx.providers.hashing import cosine_similarity
from hoursx.providers.router import ModelRouter


def split_text(text: str, chunk_size: int = 1600, overlap: int = 200) -> list[str]:
    """Split into overlapping chunks, preferring paragraph/sentence boundaries.

    Windows advance by ``chunk_size - overlap``; each window is trimmed back to
    the last blank line or sentence end inside it when one exists past the
    midpoint, so chunks tend to end at natural boundaries.
    """
    if chunk_size <= overlap:
        raise ValueError("chunk_size must exceed overlap")
    text = text.strip()
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        window = text[start : start + chunk_size]
        cut = len(window)
        if start + len(window) < len(text):  # not the final chunk — seek a boundary
            for boundary in ("\n\n", ". ", "\n"):
                pos = window.rfind(boundary)
                if pos > chunk_size // 2:
                    cut = pos + len(boundary)
                    break
        chunk = window[:cut].strip()
        if chunk:
            chunks.append(chunk)
        next_start = start + cut - overlap
        start = next_start if next_start > start else start + cut
    return chunks


@dataclass
class RetrievedChunk:
    document_id: str
    document_title: str
    text: str
    score: float


class KnowledgeEngine:
    def __init__(self, router: ModelRouter, chunk_size: int = 1600, overlap: int = 200) -> None:
        self._router = router
        self._chunk_size = chunk_size
        self._overlap = overlap

    async def ingest(self, session: AsyncSession, *, document_id: str, text: str) -> int:
        """(Re)build a document's chunks; returns the chunk count. Idempotent —
        prior chunks are replaced, so re-ingesting a failed document is safe."""
        document = await session.get(Document, document_id)
        if document is None:
            raise ValueError(f"document {document_id} not found")
        await session.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
        pieces = split_text(text, self._chunk_size, self._overlap)
        if pieces:
            embeddings = await self._router.embed(pieces)
            for index, (piece, embedding) in enumerate(zip(pieces, embeddings)):
                session.add(
                    DocumentChunk(
                        document_id=document_id,
                        workspace_id=document.workspace_id,
                        index=index,
                        text=piece,
                        embedding=embedding,
                    )
                )
        document.chunk_count = len(pieces)
        document.status = "ready"
        await session.flush()
        return len(pieces)

    async def search(
        self,
        session: AsyncSession,
        *,
        workspace_id: str,
        query: str,
        top_k: int = 6,
        min_score: float = 0.05,
    ) -> list[RetrievedChunk]:
        """Hybrid retrieval: cosine similarity + keyword-overlap bonus."""
        [query_vec] = await self._router.embed([query])
        query_terms = {term for term in query.lower().split() if len(term) > 2}

        rows = (
            await session.execute(
                select(DocumentChunk, Document.title)
                .join(Document, Document.id == DocumentChunk.document_id)
                .where(DocumentChunk.workspace_id == workspace_id)
            )
        ).all()

        results: list[RetrievedChunk] = []
        for chunk, title in rows:
            score = cosine_similarity(query_vec, chunk.embedding)
            if query_terms:
                chunk_terms = set(chunk.text.lower().split())
                score += 0.1 * (len(query_terms & chunk_terms) / len(query_terms))
            if score >= min_score:
                results.append(
                    RetrievedChunk(
                        document_id=chunk.document_id,
                        document_title=title,
                        text=chunk.text,
                        score=round(score, 4),
                    )
                )
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k]
