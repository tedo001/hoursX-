"use client";

/** Agent management: list, create, delete. */

import { useEffect, useState } from "react";

import Shell from "@/components/Shell";
import { api, ApiError, getToken } from "@/lib/api";
import type { AgentProfile } from "@/lib/types";

const DEFAULT_GRANTS =
  "fs.*, code.patch, shell.run, git.*, http.fetch, knowledge.*, memory.*";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [modelAlias, setModelAlias] = useState("deep");
  const [grants, setGrants] = useState(DEFAULT_GRANTS);
  const [canDelegate, setCanDelegate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api.listAgents().then(setAgents).catch(() => {});

  useEffect(() => {
    if (getToken()) refresh();
  }, []);

  const create = async () => {
    setError(null);
    try {
      await api.createAgent({
        handle,
        title,
        instructions,
        model_alias: modelAlias,
        tool_grants: grants
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean),
        can_delegate: canDelegate,
      });
      setHandle("");
      setTitle("");
      setInstructions("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to create agent");
    }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-2xl font-bold">Agents</h1>

        <div className="card mb-8 space-y-4">
          <h2 className="font-semibold">New agent</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Handle</label>
              <input
                className="input"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="researcher"
              />
            </div>
            <div>
              <label className="label">Title</label>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Research Agent"
              />
            </div>
          </div>
          <div>
            <label className="label">Instructions</label>
            <textarea
              className="input"
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="What should this agent be good at?"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Model alias</label>
              <select
                className="input"
                value={modelAlias}
                onChange={(e) => setModelAlias(e.target.value)}
              >
                <option value="deep">deep</option>
                <option value="fast">fast</option>
              </select>
            </div>
            <div>
              <label className="label">Tool grants (comma-separated)</label>
              <input
                className="input"
                value={grants}
                onChange={(e) => setGrants(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={canDelegate}
              onChange={(e) => setCanDelegate(e.target.checked)}
            />
            May delegate sub-tasks to other agents
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn" onClick={create} disabled={!handle || !title}>
            Create agent
          </button>
        </div>

        <div className="space-y-2">
          {agents.map((agent) => (
            <div key={agent.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">
                    {agent.title}{" "}
                    <span className="text-sm text-slate-500">@{agent.handle}</span>
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {agent.instructions || "No instructions"}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    model: {agent.model_alias} · tools:{" "}
                    {agent.tool_grants.join(", ") || "none"}
                    {agent.can_delegate && " · can delegate"}
                  </p>
                </div>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => api.deleteAgent(agent.id).then(refresh)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {agents.length === 0 && (
            <p className="text-sm text-slate-500">No agents yet.</p>
          )}
        </div>
      </div>
    </Shell>
  );
}
