import contextPrefixes from "@/shared/contextPrefixes.json";

// Context detection — single source of truth is shared/contextPrefixes.json
export const CONTEXT_STARTS_WITH: string[] = contextPrefixes.startsWith;
export const CONTEXT_CONTAINS: string[] = contextPrefixes.contains;

export function isContextText(text: string): boolean {
  return CONTEXT_STARTS_WITH.some((p) => text.startsWith(p))
    || CONTEXT_CONTAINS.some((m) => text.includes(m));
}

// Special message markers
export const HEARTBEAT_MARKER = "HEARTBEAT_OK";
export const NO_REPLY_MARKER = "NO_REPLY";

/** Returns true if any line, after stripping non-letter/underscore characters, equals HEARTBEAT_OK.
 * This handles cases where the model wraps the marker in formatting (e.g. **HEARTBEAT_OK**). */
export function hasHeartbeatOnOwnLine(text: string): boolean {
  return text.split("\n").some(
    (line) => line.replace(/[^A-Za-z_]/g, "") === HEARTBEAT_MARKER
  );
}

/** Returns true only if `marker` appears in `text` outside of double-quoted strings. */
export function hasUnquotedMarker(text: string, marker: string): boolean {
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      // Skip everything inside quotes
      i++;
      while (i < text.length && text[i] !== '"') i++;
      i++; // skip closing quote
    } else if (text.startsWith(marker, i)) {
      return true;
    } else {
      i++;
    }
  }
  return false;
}
// Legacy named exports (derived from shared/contextPrefixes.json)
export const SYSTEM_PREFIX = CONTEXT_STARTS_WITH[0];
export const SYSTEM_MESSAGE_PREFIX = CONTEXT_STARTS_WITH[1];
export const QUEUED_ANNOUNCE_PREFIX = CONTEXT_STARTS_WITH[2];
export const GATEWAY_INJECTED_MODEL = "gateway-injected";
export const LITTERBOX_UPLOAD_URL = "https://litterbox.catbox.moe/resources/internals/api.php";

// WebSocket protocol
export const WS_HELLO_OK = "hello-ok";
export const STOP_REASON_INJECTED = "injected";
export const INTERNAL_COMMAND_FETCH_RUN_PREFIX = "cmdfetch-";

export function isInternalCommandFetchRunId(runId: unknown): runId is string {
  return typeof runId === "string" && runId.startsWith(INTERNAL_COMMAND_FETCH_RUN_PREFIX);
}

// UI design tokens
export const SQUIRCLE_RADIUS = 22;
export const PILL_BASE_HEIGHT = 48;
export const RADIUS_TRANSITION = "border-radius 300ms ease";
export const MESSAGE_SEND_ANIMATION = "messageSend 350ms cubic-bezier(0.34, 1.56, 0.64, 1) both";
export const TOOL_CALL_BUBBLE_BG = "oklch(1 0 0)";
export const TOOL_CALL_BUBBLE_TEXT = "oklch(0.4 0 0)";
export const TOOL_CALL_BUBBLE_MUTED = "oklch(0.56 0 0)";
export const TOOL_CALL_BUBBLE_BORDER = "oklch(0.9 0 0)";
export const TOOL_CALL_BUBBLE_BORDER_ERROR = "oklch(0.78 0.06 25.723)";
export const TOOL_CALL_BUBBLE_SHADOW = "none";

// Content part type helpers (normalizes "tool_call" vs "toolCall")
export function isToolCallPart(p: { type: string }): boolean {
  return p.type === "tool_call" || p.type === "toolCall";
}
export function isImagePart(p: { type: string }): boolean {
  return p.type === "image" || p.type === "image_url";
}

// Tool name helpers (normalizes multiple aliases)
export const SPAWN_TOOL_NAME = "sessions_spawn";
export function isReadTool(name: string): boolean {
  return name === "read" || name === "readFile" || name === "read_file";
}
export function isEditTool(name: string): boolean {
  return name === "edit" || name === "file_edit" || name === "editFile";
}
export function isWriteTool(name: string): boolean {
  return name === "write" || name === "write_file" || name === "writeFile";
}
export function isGatewayTool(name: string): boolean {
  return name === "gateway";
}
