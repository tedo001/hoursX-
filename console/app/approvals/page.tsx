"use client";

/** Pending approvals: the human gate for tool calls across all runs. */

import { useEffect, useState } from "react";

import Shell from "@/components/Shell";
import { api, getToken } from "@/lib/api";
import type { Approval } from "@/lib/types";
import { useEvents } from "@/lib/useEvents";

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);

  const refresh = () => api.listApprovals().then(setApprovals).catch(() => {});

  useEffect(() => {
    if (getToken()) refresh();
  }, []);

  useEvents((event) => {
    if (event.type === "run.awaiting_approval" || event.type === "approval.decided") {
      refresh();
    }
  });

  const decide = async (id: string, approved: boolean) => {
    await api.decideApproval(id, approved);
    refresh();
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-2xl font-bold">Approvals</h1>
        {approvals.length === 0 && (
          <p className="text-sm text-slate-500">
            Nothing waiting on you. Runs pause here when a tool call needs a
            human decision.
          </p>
        )}
        <div className="space-y-3">
          {approvals.map((approval) => (
            <div key={approval.id} className="card border-amber-500/40">
              <p className="text-sm">
                Run <code className="text-slate-400">{approval.run_id.slice(0, 8)}</code>{" "}
                wants to execute{" "}
                <code className="rounded bg-ink-800 px-1 text-amber-300">
                  {approval.tool_name}
                </code>
              </p>
              <pre className="my-3 overflow-x-auto rounded bg-ink-800 p-3 text-xs text-slate-400">
                {JSON.stringify(approval.arguments, null, 2)}
              </pre>
              <p className="mb-3 text-xs text-slate-500">{approval.reason}</p>
              <div className="flex gap-2">
                <button className="btn" onClick={() => decide(approval.id, true)}>
                  Approve
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => decide(approval.id, false)}
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
