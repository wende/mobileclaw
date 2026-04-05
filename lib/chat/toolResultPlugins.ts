/**
 * Maps MCP tool results to plugin content parts.
 * When MobileClaw receives a tool result for a known 8claw tool via OpenClaw,
 * this module generates the corresponding plugin part so the existing plugin
 * components render inline — even though no emitPlugin() side-effect fired.
 */

import type { ContentPart, Message, PluginContentPart } from "@mc/types/chat";

type PluginMatch = PluginContentPart | null;

/**
 * Scan history messages for tool_call parts with results that map to plugins.
 * Injects plugin content parts after matching tool calls. Idempotent — skips
 * messages that already have plugin parts with the same partId.
 */
export function injectPluginsFromHistory(messages: Message[]): Message[] {
  let changed = false;
  const result = messages.map((msg) => {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg;

    const newParts: ContentPart[] = [];
    let msgChanged = false;

    for (const part of msg.content) {
      newParts.push(part);

      if ((part.type === "tool_call" || part.type === "toolCall") && part.name && part.result && part.status === "success") {
        const plugin = pluginFromToolResult(part.name, part.result, !!part.resultError);
        if (plugin) {
          // Skip if already injected
          const alreadyExists = msg.content.some(
            (p) => p.type === "plugin" && p.partId === plugin.partId,
          );
          if (!alreadyExists) {
            newParts.push(plugin);
            msgChanged = true;
          }
        }
      }
    }

    if (msgChanged) {
      changed = true;
      return { ...msg, content: newParts };
    }
    return msg;
  });

  return changed ? result : messages;
}

/** Strip MCP server prefix (e.g. "octoclaw__list_flows" → "list_flows") */
function stripMcpPrefix(name: string): string {
  const idx = name.lastIndexOf("__");
  return idx >= 0 ? name.slice(idx + 2) : name;
}

/** Try to derive a plugin part from a tool result. Returns null if no match. */
export function pluginFromToolResult(
  toolName: string,
  resultText: string,
  isError: boolean,
): PluginMatch {
  if (isError) return null;

  let data: unknown;
  try {
    data = JSON.parse(resultText);
  } catch {
    return null;
  }

  switch (stripMcpPrefix(toolName)) {
    case "list_flows":
      return buildFlowListPlugin(data);
    case "get_flow":
      return buildFlowCanvasPlugin(data);
    case "list_flow_runs":
      return buildRunListPlugin(data);
    case "get_flow_run":
      return buildRunDetailPlugin(data);
    default:
      return null;
  }
}

// ── Flow List ──────────────────────────────────────────────────────────────

function buildFlowListPlugin(data: unknown): PluginMatch {
  const d = data as Record<string, unknown> | null;
  const flows = Array.isArray(d?.data) ? d!.data : null;
  if (!flows || flows.length === 0) return null;

  return {
    type: "plugin",
    pluginType: "flow_list_card",
    partId: `flow-list-${Date.now()}`,
    state: "settled",
    data: {
      flows: flows.map((f: Record<string, unknown>) => ({
        id: f.id,
        displayName: f.displayName || "Untitled",
        status: f.status || "DISABLED",
        triggerPiece: f.triggerPiece ?? null,
        stepCount: f.stepCount ?? 0,
        lastRun: f.lastRun ?? null,
      })),
    },
  };
}

// ── Flow Canvas ────────────────────────────────────────────────────────────

function buildFlowCanvasPlugin(data: unknown): PluginMatch {
  const d = data as Record<string, unknown> | null;
  if (!d?.trigger) return null;

  const steps = extractSteps(d);
  if (steps.length === 0) return null;

  return {
    type: "plugin",
    pluginType: "flow_canvas",
    partId: `flow-canvas-${d.id || Date.now()}`,
    state: "settled",
    data: {
      flowId: d.id || "",
      displayName: d.displayName || "Untitled",
      status: d.status ?? "DRAFT",
      steps,
    },
  };
}

function extractSteps(flow: Record<string, unknown>): Array<Record<string, unknown>> {
  const steps: Array<Record<string, unknown>> = [];
  const trigger = flow.trigger as Record<string, unknown> | undefined;
  if (!trigger) return steps;

  let num = 1;
  steps.push({
    name: trigger.name || "trigger",
    displayName: trigger.displayName || "Trigger",
    type: "trigger",
    pieceName: ((trigger.settings as Record<string, unknown>)?.pieceName as string) || undefined,
    stepNumber: num++,
    valid: trigger.valid !== false,
  });

  const walk = (action: unknown) => {
    if (!action || typeof action !== "object") return;
    const a = action as Record<string, unknown>;
    const type =
      a.type === "CODE" ? "code"
      : a.type === "LOOP_ON_ITEMS" ? "loop"
      : a.type === "ROUTER" ? "router"
      : "piece";
    steps.push({
      name: a.name,
      displayName: a.displayName || a.name,
      type,
      pieceName: ((a.settings as Record<string, unknown>)?.pieceName as string) || undefined,
      stepNumber: num++,
      valid: a.valid !== false,
    });
    if (a.nextAction) walk(a.nextAction);
  };
  walk(trigger.nextAction);

  return steps;
}

// ── Run List ───────────────────────────────────────────────────────────────

function buildRunListPlugin(data: unknown): PluginMatch {
  const d = data as Record<string, unknown> | null;
  const runs = Array.isArray(d?.data) ? d!.data : null;
  if (!runs || runs.length === 0) return null;

  return {
    type: "plugin",
    pluginType: "flow_run_list_card",
    partId: `run-list-${Date.now()}`,
    state: "settled",
    data: {
      runs: runs.map((r: Record<string, unknown>) => ({
        runId: (r.id || r.runId || "") as string,
        flowId: (r.flowId || "") as string,
        flowName: (r.flowDisplayName || r.flowName || "Flow") as string,
        status: (r.status || "UNKNOWN") as string,
        stepsCount: r.stepsCount as number | undefined,
        startTime: (r.startTime || r.created || r.createdAt || "") as string,
        finishTime: (r.finishTime || "") as string,
        durationMs: typeof r.duration === "number" ? r.duration : (r.durationMs as number | undefined),
      })),
    },
  };
}

// ── Run Detail ─────────────────────────────────────────────────────────────

function buildRunDetailPlugin(data: unknown): PluginMatch {
  const d = data as Record<string, unknown> | null;
  if (!d?.id) return null;

  return {
    type: "plugin",
    pluginType: "flow_run_detail_card",
    partId: `run-detail-${d.id}`,
    state: "settled",
    data: d,
  };
}
