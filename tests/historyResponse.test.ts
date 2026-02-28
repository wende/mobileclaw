import { describe, expect, it } from "vitest";

import { mergeHistoryWithOptimistic } from "@/lib/chat/historyResponse";
import type { Message } from "@/types/chat";

describe("mergeHistoryWithOptimistic", () => {
  it("keeps already-rendered realtime messages when history snapshot lags", () => {
    const previous: Message[] = [
      { role: "user", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", id: "hist-1", timestamp: 1001, content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", id: "run-2", timestamp: 1002, content: [{ type: "text", text: "Fresh realtime reply" }] },
    ];

    const staleHistory: Message[] = [
      { role: "user", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", id: "hist-1", timestamp: 1001, content: [{ type: "text", text: "Hello" }] },
    ];

    expect(mergeHistoryWithOptimistic(staleHistory, previous)).toEqual(previous);
  });

  it("still appends optimistic user messages that are missing from history", () => {
    const previous: Message[] = [
      { role: "assistant", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Ready" }] },
      { role: "user", id: "u-1", timestamp: 1001, content: [{ type: "text", text: "Pending send" }] },
    ];

    const history: Message[] = [
      { role: "assistant", id: "hist-0", timestamp: 1000, content: [{ type: "text", text: "Ready" }] },
    ];

    const merged = mergeHistoryWithOptimistic(history, previous);
    expect(merged).toHaveLength(2);
    expect(merged[1].id).toBe("u-1");
  });
});
