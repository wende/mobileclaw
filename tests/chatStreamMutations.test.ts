import { describe, it, expect } from "vitest";

import {
  addToolCall,
  appendContentDelta,
  appendThinkingDelta,
  resolveToolCall,
  upsertFinalRunMessage,
} from "@/lib/chat/streamMutations";
import type { Message } from "@/types/chat";

describe("chat stream mutations", () => {
  it("appends text after tool call boundary without destroying earlier text", () => {
    const initial: Message[] = [{
      role: "assistant",
      id: "run-1",
      content: [
        { type: "text", text: "before" },
        { type: "tool_call", name: "read", status: "running" },
      ],
    }];

    const step1 = appendContentDelta(initial, "run-1", " after", Date.now());
    const parts1 = step1.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts1.map((p) => p.text || "").join(" ")).toContain("before");
    expect(parts1[2]?.text).toBe(" after");

    const step2 = appendContentDelta(step1.messages, "run-1", " more", Date.now());
    const parts2 = step2.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts2[2]?.text).toBe(" after more");
  });

  it("adds and extends thinking deltas by segment", () => {
    const initial: Message[] = [{ role: "assistant", id: "run-2", content: [] }];
    const step1 = appendThinkingDelta(initial, "run-2", "plan", Date.now());
    const step2 = appendThinkingDelta(step1.messages, "run-2", " now", Date.now());

    const parts = step2.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("thinking");
    expect(parts[0].text).toBe("plan now");
  });

  it("handles cumulative snapshot deltas without duplicating text", () => {
    const initial: Message[] = [{ role: "assistant", id: "run-dup", content: [] }];
    const step1 = appendContentDelta(initial, "run-dup", "Let", Date.now());
    const step2 = appendContentDelta(step1.messages, "run-dup", "Lets See", Date.now());
    const step3 = appendContentDelta(step2.messages, "run-dup", "Lets See what's in the file", Date.now());

    const parts = step3.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("text");
    expect(parts[0].text).toBe("Lets See what's in the file");
  });

  it("still appends normal repeated incremental chunks", () => {
    const initial: Message[] = [{ role: "assistant", id: "run-repeat", content: [] }];
    const step1 = appendContentDelta(initial, "run-repeat", "ha", Date.now());
    const step2 = appendContentDelta(step1.messages, "run-repeat", "ha", Date.now());

    const parts = step2.messages[0].content as Array<{ type: string; text?: string }>;
    expect(parts[0].text).toBe("haha");
  });

  it("resolves tool calls by toolCallId and by name fallback", () => {
    const created = addToolCall([], "run-3", "write", Date.now(), "tc-1", "{}");
    const byId = resolveToolCall(created.messages, "run-3", "write", "tc-1", "ok", false);
    const partById = (byId[0].content as Array<{ status?: string; result?: string }>)[0];
    expect(partById.status).toBe("success");
    expect(partById.result).toBe("ok");

    const noIdInitial = addToolCall([], "run-4", "edit", Date.now());
    const byName = resolveToolCall(noIdInitial.messages, "run-4", "edit", undefined, "done", false);
    const partByName = (byName[0].content as Array<{ status?: string; result?: string }>)[0];
    expect(partByName.status).toBe("success");
    expect(partByName.result).toBe("done");
  });

  it("fills an existing placeholder from a final-only payload", () => {
    const initial: Message[] = [{
      role: "assistant",
      id: "run-final",
      content: [],
      isCommandResponse: true,
    }];

    const next = upsertFinalRunMessage(initial, "run-final", {
      role: "assistant",
      content: "Conversation compacted.",
      timestamp: 1234,
    });

    expect(next).toHaveLength(1);
    expect(next[0].isCommandResponse).toBe(true);
    expect(next[0].timestamp).toBe(1234);
    expect((next[0].content as Array<{ type: string; text?: string }>)[0].text).toBe("Conversation compacted.");
  });

  it("appends a message when final payload arrives without prior deltas", () => {
    const next = upsertFinalRunMessage([], "run-new", {
      role: "assistant",
      content: "Final-only response",
      timestamp: 555,
      reasoning: "quick thought",
    });

    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("run-new");
    expect(next[0].reasoning).toBe("quick thought");
    expect((next[0].content as Array<{ type: string; text?: string }>)[0].text).toBe("Final-only response");
  });

  it("ignores empty final payloads when there is nothing to upsert", () => {
    const initial: Message[] = [{ role: "assistant", id: "a1", content: [{ type: "text", text: "existing" }] }];
    const next = upsertFinalRunMessage(initial, "run-empty", {
      role: "assistant",
      content: [],
    });
    expect(next).toEqual(initial);
  });
});
