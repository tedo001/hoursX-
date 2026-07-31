/** Wire types mirroring the HoursX API schemas. */

export interface TokenResponse {
  access_token: string;
  user_id: string;
  workspace_id: string;
}

export interface AgentProfile {
  id: string;
  handle: string;
  title: string;
  instructions: string;
  model_alias: string;
  tool_grants: string[];
  can_delegate: boolean;
  max_steps: number | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  title: string;
  agent_profile_id: string;
  created_at: string;
  archived: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  run_id: string | null;
  created_at: string;
}

export interface Run {
  id: string;
  session_id: string;
  status:
    | "queued"
    | "running"
    | "awaiting_approval"
    | "succeeded"
    | "failed"
    | "cancelled";
  goal: string;
  final_answer: string | null;
  error: string | null;
  step_count: number;
}

export interface Approval {
  id: string;
  run_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  reason: string;
  status: string;
  created_at: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  source: string;
  status: string;
  chunk_count: number;
  created_at: string;
}

export interface SearchHit {
  document_id: string;
  document_title: string;
  text: string;
  score: number;
}

export interface PlatformEvent {
  type: string;
  workspace_id: string;
  session_id: string | null;
  run_id: string | null;
  payload: Record<string, unknown>;
  at: number;
}
