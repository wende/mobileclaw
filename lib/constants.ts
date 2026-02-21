// Special message markers
export const HEARTBEAT_MARKER = "HEARTBEAT_OK";
export const NO_REPLY_MARKER = "NO_REPLY";

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
export const SYSTEM_PREFIX = "System: [";
export const SYSTEM_MESSAGE_PREFIX = "[System Message]";
export const GATEWAY_INJECTED_MODEL = "gateway-injected";

// WebSocket protocol
export const WS_HELLO_OK = "hello-ok";
export const STOP_REASON_INJECTED = "injected";

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
