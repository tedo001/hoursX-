"use client";

/** Knowledge base: upload documents and test retrieval. */

import { useEffect, useState } from "react";

import Shell from "@/components/Shell";
import { api, getToken } from "@/lib/api";
import type { KnowledgeDocument, SearchHit } from "@/lib/types";

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  const refresh = () => api.listDocuments().then(setDocuments).catch(() => {});

  useEffect(() => {
    if (getToken()) refresh();
  }, []);

  const upload = async () => {
    await api.uploadDocument(title, text);
    setTitle("");
    setText("");
    // Ingestion is async; poll briefly until it settles.
    setTimeout(refresh, 500);
    setTimeout(refresh, 2000);
    refresh();
  };

  const search = async () => {
    setHits(await api.searchKnowledge(query));
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-2xl font-bold">Knowledge</h1>

        <div className="card mb-6 space-y-3">
          <h2 className="font-semibold">Add a document</h2>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
          />
          <textarea
            className="input"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste document text…"
          />
          <button className="btn" onClick={upload} disabled={!title || !text}>
            Ingest
          </button>
        </div>

        <div className="card mb-6">
          <h2 className="mb-3 font-semibold">Search</h2>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="What are you looking for?"
            />
            <button className="btn" onClick={search} disabled={query.length < 2}>
              Search
            </button>
          </div>
          {hits && (
            <div className="mt-4 space-y-2">
              {hits.length === 0 && (
                <p className="text-sm text-slate-500">No matches.</p>
              )}
              {hits.map((hit, index) => (
                <div key={index} className="rounded-lg bg-ink-800 p-3">
                  <p className="mb-1 text-xs text-slate-500">
                    {hit.document_title} · score {hit.score.toFixed(3)}
                  </p>
                  <p className="text-sm text-slate-300">{hit.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {documents.map((doc) => (
            <div key={doc.id} className="card flex items-center justify-between">
              <div>
                <p className="font-medium">{doc.title}</p>
                <p className="text-xs text-slate-500">
                  {doc.chunk_count} chunks · {doc.source}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs ${
                  doc.status === "ready"
                    ? "bg-pulse-500/20 text-pulse-400"
                    : doc.status === "failed"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-amber-500/20 text-amber-400"
                }`}
              >
                {doc.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
