export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  source: {
    type: string;
    media_type: string;
    data: string;
  };
}

export interface ImageUrlContent {
  type: "image_url";
  image_url: { url: string };
}

export interface ToolCallContent {
  type: "tool_call";
  name: string;
  arguments: string;
}

export interface ToolResultContent {
  type: "tool_result";
  name: string;
  text: string;
}

export type MessageContent =
  | TextContent
  | ImageContent
  | ImageUrlContent
  | ToolCallContent
  | ToolResultContent;

export interface ChatMessage {
  role: "user" | "assistant" | "toolResult" | "tool_result" | "system";
  content: MessageContent[] | string | null;
  timestamp: number;
  id: string;
  reasoning?: string;
  stopReason?: string;
  usage?: { input: number; output: number; totalTokens: number };
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export type StreamState = "delta" | "final" | "aborted" | "error";

export interface ChatEvent {
  type: "event";
  event: "chat";
  seq: number;
  payload: {
    runId: string;
    sessionKey: string;
    state: StreamState;
    message?: {
      role: string;
      content: MessageContent[];
      timestamp: number;
    };
    errorMessage?: string;
  };
}

export interface ToolEvent {
  tool: string;
  status: "running" | "success" | "error";
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
}
