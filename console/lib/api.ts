/**
 * Typed client for the HoursX API.
 *
 * The access token lives in localStorage under one key; every helper reads it
 * at call time so login/logout takes effect immediately without a reload.
 */

import type {
  AgentProfile,
  Approval,
  ChatMessage,
  ChatSession,
  KnowledgeDocument,
  Run,
  SearchHit,
  TokenResponse,
} from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_HOURSX_API_URL ?? "http://localhost:8400";

const TOKEN_KEY = "hoursx.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) window.localStorage.removeItem(TOKEN_KEY);
  else window.localStorage.setItem(TOKEN_KEY, token);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    detail: string,
  ) {
    super(detail);
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers["authorization"] = `Bearer ${token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, body });
  if (response.status === 401 && typeof window !== "undefined") {
    setToken(null);
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const parsed = await response.json();
      detail =
        typeof parsed.detail === "string"
          ? parsed.detail
          : JSON.stringify(parsed.detail ?? parsed);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ------------------------------------------------------------------ auth

export const api = {
  register: (email: string, password: string, displayName: string) =>
    request<TokenResponse>("/v1/auth/register", {
      method: "POST",
      json: { email, password, display_name: displayName },
    }),
  login: (email: string, password: string) =>
    request<TokenResponse>("/v1/auth/login", {
      method: "POST",
      json: { email, password },
    }),

  // ---------------------------------------------------------------- agents
  listAgents: () => request<AgentProfile[]>("/v1/agents"),
  createAgent: (agent: {
    handle: string;
    title: string;
    instructions?: string;
    model_alias?: string;
    tool_grants?: string[];
    can_delegate?: boolean;
  }) => request<AgentProfile>("/v1/agents", { method: "POST", json: agent }),
  deleteAgent: (id: string) =>
    request<void>(`/v1/agents/${id}`, { method: "DELETE" }),

  // -------------------------------------------------------------- sessions
  listSessions: () => request<ChatSession[]>("/v1/sessions"),
  createSession: (agentProfileId: string, title: string) =>
    request<ChatSession>("/v1/sessions", {
      method: "POST",
      json: { agent_profile_id: agentProfileId, title },
    }),
  listMessages: (sessionId: string) =>
    request<ChatMessage[]>(`/v1/sessions/${sessionId}/messages`),
  sendMessage: (sessionId: string, text: string, planFirst = false) =>
    request<{ run_id: string }>(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      json: { text, plan_first: planFirst },
    }),

  // ------------------------------------------------------------------ runs
  getRun: (runId: string) => request<Run>(`/v1/runs/${runId}`),

  // ------------------------------------------------------------- approvals
  listApprovals: () => request<Approval[]>("/v1/approvals"),
  decideApproval: (approvalId: string, approved: boolean) =>
    request<{ ok: boolean }>(`/v1/approvals/${approvalId}/decision`, {
      method: "POST",
      json: { approved },
    }),

  // ------------------------------------------------------------- knowledge
  listDocuments: () => request<KnowledgeDocument[]>("/v1/knowledge/documents"),
  uploadDocument: (title: string, text: string) =>
    request<KnowledgeDocument>("/v1/knowledge/documents", {
      method: "POST",
      json: { title, text },
    }),
  searchKnowledge: (q: string) =>
    request<SearchHit[]>(`/v1/knowledge/search?q=${encodeURIComponent(q)}`),
};
