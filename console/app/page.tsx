"use client";

/** Dashboard: session list + new-session launcher. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import Shell from "@/components/Shell";
import { api, getToken } from "@/lib/api";
import type { AgentProfile, ChatSession } from "@/lib/types";

export default function SessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentId, setAgentId] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    api.listSessions().then(setSessions).catch(() => {});
    api
      .listAgents()
      .then((list) => {
        setAgents(list);
        if (list.length > 0) setAgentId(list[0].id);
      })
      .catch(() => {});
  }, []);

  const createSession = async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const session = await api.createSession(agentId, title || "New session");
      router.push(`/sessions/${session.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-2xl font-bold">Sessions</h1>

        <div className="card mb-8">
          <h2 className="mb-3 font-semibold">Start a session</h2>
          {agents.length === 0 ? (
            <p className="text-sm text-slate-400">
              No agents yet —{" "}
              <Link href="/agents" className="text-pulse-400 underline">
                create your first agent
              </Link>{" "}
              to get started.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <label className="label">Agent</label>
                <select
                  className="input"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                >
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.title} (@{agent.handle})
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-48 flex-1">
                <label className="label">Title</label>
                <input
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What is this about?"
                />
              </div>
              <button className="btn" onClick={createSession} disabled={busy}>
                Start
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/sessions/${session.id}`}
              className="card block transition hover:border-pulse-500"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{session.title}</span>
                <span className="text-xs text-slate-500">
                  {new Date(session.created_at).toLocaleString()}
                </span>
              </div>
            </Link>
          ))}
          {sessions.length === 0 && (
            <p className="text-sm text-slate-500">No sessions yet.</p>
          )}
        </div>
      </div>
    </Shell>
  );
}
