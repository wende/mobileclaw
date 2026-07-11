import type { PluginContentPart } from "@mc/types/chat";

type PluginMatch = PluginContentPart | null;

/**
 * 8claw tool results → inline plugin cards.
 * Maps bare MCP tool names (server prefix already stripped) to builders for
 * the cards in this directory. The generic injection mechanism lives in
 * lib/chat/toolResultPlugins.ts and knows nothing about these tools.
 */
export const appToolResultBuilders: Record<string, (data: unknown) => PluginMatch> = {
  list_flows: buildFlowListPlugin,
  get_flow: buildFlowCanvasPlugin,
  list_flow_runs: buildRunListPlugin,
  get_flow_run: buildRunDetailPlugin,
};

// ── Flow List ──────────────────────────────────────────────────────────────

function buildFlowListPlugin(data: unknown): PluginMatch {
  const d = data as Record<string, unknown> | null;
  const flows = Array.isArray(d?.data) ? d.data : null;
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

  const flowId = typeof d.id === "string" || typeof d.id === "number" ? String(d.id) : "";

  return {
    type: "plugin",
    pluginType: "flow_canvas",
    partId: `flow-canvas-${flowId || Date.now()}`,
    state: "settled",
    data: {
      flowId,
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
  const runs = Array.isArray(d?.data) ? d.data : null;
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
  const runId = typeof d.id === "string" || typeof d.id === "number" ? String(d.id) : Date.now();

  return {
    type: "plugin",
    pluginType: "flow_run_detail_card",
    partId: `run-detail-${runId}`,
    state: "settled",
    data: d,
  };
}
