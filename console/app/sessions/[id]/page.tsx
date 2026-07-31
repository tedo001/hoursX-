"use client";

/**
 * Chat view: history + live run streaming.
 *
 * Persisted messages come from the REST API; in-flight output streams over the
 * workspace WebSocket (`run.delta` events accumulate into a draft bubble, and
 * `run.finished` promotes it to a real message). Approval pauses render inline
 * with approve/deny actions.
 */

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import Shell from "@/components/Shell";
import { api, getToken } from "@/lib/api";
import type { Approval, ChatMessage, PlatformEvent } from "@/lib/types";
import { useEvents } from "@/lib/useEvents";

interface LiveRun {
  runId: string;
  draft: string;
  status: "running" | "awaiting_approval";
  toolNote: string | null;
  approval: { id: string; tool: string; args: string } | null;
}

export default function SessionPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [input, setInput] = useState("");
  const [planFirst, setPlanFirst] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    api.listMessages(sessionId).then(setMessages).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (getToken()) refresh();
  }, [refresh]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, live]);

  useEvents((event: PlatformEvent) => {
    if (event.session_id !== sessionId || !event.run_id) return;
    const runId = event.run_id;
    switch (event.type) {
      case "run.started":
        setLive({ runId, draft: "", status: "running", toolNote: null, approval: null });
        break;
      case "run.delta":
        setLive((prev) =>
          prev && prev.runId === runId
            ? { ...prev, draft: prev.draft + String(event.payload.text ?? "") }
            : prev,
        );
        break;
      case "run.step":
        setLive((prev) =>
          prev && prev.runId === runId
            ? { ...prev, toolNote: String(event.payload.summary ?? "") }
            : prev,
        );
        break;
      case "run.awaiting_approval":
        setLive((prev) =>
          prev && prev.runId === runId
            ? {
                ...prev,
                status: "awaiting_approval",
                approval: {
                  id: String(event.payload.approval_id),
                  tool: String(event.payload.tool),
                  args: JSON.stringify(event.payload.arguments),
                },
              }
            : prev,
        );
        break;
      case "run.finished":
        setLive(null);
        refresh();
        break;
    }
  });

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: text,
        run_id: null,
        created_at: new Date().toISOString(),
      },
    ]);
    await api.sendMessage(sessionId, text, planFirst);
  };

  const decide = async (approvalId: string, approved: boolean) => {
    await api.decideApproval(approvalId, approved);
    setLive((prev) =>
      prev ? { ...prev, status: "running", approval: null } : prev,
    );
  };

  return (
    <Shell>
      <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-3xl flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto pb-4">
          {messages.map((message) => (
            <Bubble key={message.id} role={message.role} text={message.content} />
          ))}
          {live && (
            <div>
              <Bubble
                role="assistant"
                text={live.draft || "…"}
                streaming
              />
              {live.toolNote && (
                <p className="mt-1 pl-2 text-xs text-slate-500">
                  ⚙ {live.toolNote}
                </p>
              )}
              {live.approval && (
                <div className="card mt-2 border-amber-500/50">
                  <p className="mb-2 text-sm">
                    The agent wants to run{" "}
                    <code className="rounded bg-ink-800 px-1 text-amber-300">
                      {live.approval.tool}
                    </code>
                  </p>
                  <pre className="mb-3 overflow-x-auto rounded bg-ink-800 p-2 text-xs text-slate-400">
                    {live.approval.args}
                  </pre>
                  <div className="flex gap-2">
                    <button
                      className="btn"
                      onClick={() => decide(live.approval!.id, true)}
                    >
                      Approve
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => decide(live.approval!.id, false)}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={bottom} />
        </div>
        <div className="border-t border-ink-700 pt-4">
          <div className="flex gap-2">
            <textarea
              className="input min-h-12 flex-1 resize-none"
              rows={2}
              value={input}
              placeholder="Give the agent a goal…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn self-end" onClick={send}>
              Send
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={planFirst}
              onChange={(e) => setPlanFirst(e.target.checked)}
            />
            Plan before executing
          </label>
        </div>
      </div>
    </Shell>
  );
}

function Bubble({
  role,
  text,
  streaming = false,
}: {
  role: string;
  text: string;
  streaming?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-2 text-sm ${
          isUser
            ? "bg-pulse-500 text-ink-950"
            : "border border-ink-700 bg-ink-900 text-slate-200"
        } ${streaming ? "animate-pulse-slow" : ""}`}
      >
        {text}
      </div>
    </div>
  );
}
