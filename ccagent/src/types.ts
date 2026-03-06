// SDK messages (stdout from Claude Code)

export interface SystemMessage {
  type: "system";
  session_id: string;
  tools: unknown[];
  model: string;
  [key: string]: unknown;
}

export interface StreamEventMessage {
  type: "stream_event";
  event: { type: string; [key: string]: unknown };
  session_id: string;
}

export interface AssistantMessage {
  type: "assistant";
  message: {
    content: ContentBlock[];
    [key: string]: unknown;
  };
  session_id: string;
}

export interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface ToolUseMessage {
  type: "tool_use";
  tool_name: string;
  input: unknown;
  [key: string]: unknown;
}

export interface ToolResultMessage {
  type: "tool_result";
  result: unknown;
  is_error: boolean;
  [key: string]: unknown;
}

export interface ResultMessage {
  type: "result";
  subtype: string;
  is_error: boolean;
  duration_ms: number;
  session_id: string;
  result: unknown;
}

export interface UserEchoMessage {
  type: "user";
  message: unknown;
  is_replay?: boolean;
  [key: string]: unknown;
}

export type SdkMessage =
  | SystemMessage
  | StreamEventMessage
  | AssistantMessage
  | ToolUseMessage
  | ToolResultMessage
  | ResultMessage
  | UserEchoMessage;

// SDK control messages (stdin to Claude Code)

export interface ControlRequest {
  type: "control_request";
  request_id: string;
  request: {
    subtype: string;
    [key: string]: unknown;
  };
}

export interface UserInput {
  type: "user";
  message: {
    role: "user";
    content: string;
  };
}

export type StdinMessage = ControlRequest | UserInput;

// WebSocket protocol (client <-> ccagent)

export interface ClientPrompt {
  type: "prompt";
  text: string;
  sessionId?: string;
  cwd?: string;
  systemPrompt?: string;
}

export interface ServerStatus {
  type: "status";
  payload: { state: ProcessState };
}

export interface ServerSessionInfo {
  type: "session_info";
  payload: { sessionId: string };
}

export interface ServerClaudeMessage {
  type: "claude_message";
  payload: SdkMessage;
}

export interface ServerError {
  type: "error";
  payload: { message: string };
}

export type ServerMessage =
  | ServerStatus
  | ServerSessionInfo
  | ServerClaudeMessage
  | ServerError;

export type ProcessState =
  | "spawning"
  | "initializing"
  | "ready"
  | "busy"
  | "finished";
