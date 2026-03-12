import { describe, expect, it } from "vitest";

import {
  appendPluginActionPayloadToUrl,
  getPluginActionHostPayload,
  mergePluginActionPayload,
} from "@/lib/plugins/actionPayload";
import type { PluginActionInvocation } from "@/lib/plugins/types";

const invocation: PluginActionInvocation = {
  messageId: "message-123",
  part: {
    type: "plugin",
    partId: "pause-1",
    pluginType: "pause_card",
    state: "active",
    data: { prompt: "Proceed?" },
  },
  action: {
    id: "continue",
    label: "Continue rollout",
    request: {
      kind: "ws",
      method: "agent.pause.respond",
      params: { selectedValue: "continue" },
    },
  },
};

describe("plugin action payload", () => {
  it("derives host-owned identifiers from the invocation", () => {
    expect(getPluginActionHostPayload(invocation)).toEqual({
      messageId: "message-123",
      partId: "pause-1",
      pluginType: "pause_card",
    });
  });

  it("merges plugin input with host-owned identifiers", () => {
    expect(mergePluginActionPayload(
      { selectedValue: "continue" },
      { ...invocation, input: { comment: "Ship it" } },
    )).toEqual({
      selectedValue: "continue",
      comment: "Ship it",
      messageId: "message-123",
      partId: "pause-1",
      pluginType: "pause_card",
    });
  });

  it("does not allow plugin-provided ids to override host-owned identifiers", () => {
    expect(mergePluginActionPayload(
      { messageId: "forged", partId: "forged", pluginType: "status_card" },
      { ...invocation, input: { messageId: "other", partId: "other", pluginType: "weather_map" } },
    )).toEqual({
      messageId: "message-123",
      partId: "pause-1",
      pluginType: "pause_card",
    });
  });

  it("returns only host-owned identifiers when no plugin payload is provided", () => {
    expect(mergePluginActionPayload(
      undefined,
      { ...invocation, input: undefined },
    )).toEqual({
      messageId: "message-123",
      partId: "pause-1",
      pluginType: "pause_card",
    });
  });

  it("encodes merged payload into GET query params", () => {
    expect(appendPluginActionPayloadToUrl("/api/pause?existing=1", {
      selectedValue: "continue",
      selectedLabel: "Continue rollout",
      meta: { dryRun: true },
    })).toBe("/api/pause?existing=1&selectedValue=continue&selectedLabel=Continue+rollout&meta=%7B%22dryRun%22%3Atrue%7D");
  });
});
