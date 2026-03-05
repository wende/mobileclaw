import { v4 as uuidv4 } from "uuid";
import type { Writable } from "node:stream";
import type { ControlRequest, SdkMessage } from "./types.js";

export function sendJson(stdin: Writable, msg: unknown): void {
  stdin.write(JSON.stringify(msg) + "\n");
}

export function createLineParser(
  callback: (msg: SdkMessage) => void
): (chunk: Buffer) => void {
  let buffer = "";
  return (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop()!; // keep incomplete last line in buffer
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as SdkMessage;
        callback(parsed);
      } catch {
        // skip non-JSON lines (e.g. stderr leaking to stdout)
      }
    }
  };
}

export function buildInitializeRequest(): ControlRequest {
  return {
    type: "control_request",
    request_id: uuidv4(),
    request: {
      subtype: "initialize",
      hooks: null,
    },
  };
}

export function buildSetPermissionRequest(): ControlRequest {
  return {
    type: "control_request",
    request_id: uuidv4(),
    request: {
      subtype: "set_permission_mode",
      mode: "bypassPermissions",
    },
  };
}
