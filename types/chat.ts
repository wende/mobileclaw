export type ContentPartType = "text" | "tool_call" | "toolCall" | "thinking" | "image" | "image_url";
export type MessageRole = "user" | "assistant" | "system" | "tool" | "toolResult" | "tool_result";

export interface ContentPart {
  type: ContentPartType;
  text?: string;
  thinking?: string;
  name?: string;
  toolCallId?: string;
  arguments?: string;
  status?: "running" | "success" | "error";
  result?: string;
  resultError?: boolean;
  source?: Record<string, unknown>;
  image_url?: { url?: string };
  subagentSessionKey?: string;
}

export interface SubagentEntry {
  type: "text" | "tool" | "reasoning";
  text: string;
  toolStatus?: "running" | "success" | "error";
  ts: number;
}

export interface SubagentSession {
  entries: SubagentEntry[];
  status: "active" | "done" | "error";
}

export interface Message {
  role: MessageRole;
  content: ContentPart[] | string | null;
  timestamp?: number;
  id?: string;
  reasoning?: string;
  toolName?: string;
  toolArgs?: string;
  isError?: boolean;
  stopReason?: string;
  isContext?: boolean;
  thinkingDuration?: number; // Seconds spent "thinking" before first content
  runDuration?: number; // Total seconds the run took (lifecycle start → end)
}

// OpenClaw WebSocket protocol types
// Based on GatewayBrowserClient protocol

// Request (client → server)
export interface WSRequest {
  type: "req";
  id: string;
  method: "connect" | "chat.send" | "chat.abort" | "chat.history" | "chat.subscribe" | "hello" | "models.list";
  params?: Record<string, unknown>;
}

// Response (server → client)
export interface WSResponse {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string | { code: string; message: string };
}

// Event (server → client)
export interface WSEvent {
  type: "event";
  event: "connect.challenge" | "chat" | "agent" | "presence" | "health";
  payload: ConnectChallengePayload | ChatEventPayload | AgentEventPayload;
  seq: number;
  stateVersion?: {
    presence: number;
    health: number;
  };
}

// Connect challenge payload
export interface ConnectChallengePayload {
  nonce: string;
  ts: number;
}

// Chat event payload
export interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: {
    role: "user" | "assistant" | "system" | "tool";
    content: ContentPart[] | string;
    timestamp: number;
    reasoning?: string;
  };
  errorMessage?: string;
}

// Agent event payload — actual format uses stream + data
export type AgentStreamType = "lifecycle" | "content" | "tool" | "reasoning" | "assistant" | "error" | (string & {});

export interface AgentEventPayload {
  runId: string;
  sessionKey: string;
  stream: AgentStreamType;
  data: Record<string, unknown>;
  seq: number;
  ts: number;
}

// Hello message (server → client on connect)
export interface WSHello {
  type: "hello";
  sessionId: string;
  mode: "webchat";
  clientName: string;
}

export type WSIncomingMessage = WSResponse | WSEvent | WSHello;

export interface ImageAttachment {
  mimeType: string;
  fileName: string;
  content: string; // base64
  previewUrl: string; // object URL for local preview
}

export type BackendMode = "openclaw" | "lmstudio" | "demo";

export interface ConnectionConfig {
  mode: BackendMode;
  url: string;
  token?: string;
  model?: string;
}

// Model choice from models.list response
export interface ModelChoice {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
}
