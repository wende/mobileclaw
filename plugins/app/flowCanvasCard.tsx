"use client";

import { z } from "zod";
import type { MobileClawPlugin, PluginViewProps } from "@mc/lib/plugins/types";

// ── Schema ──────────────────────────────────────────────────────────────────

const stepSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  type: z.enum(["trigger", "piece", "code", "loop", "router"]).default("piece"),
  pieceName: z.string().optional(),
  stepNumber: z.number(),
  valid: z.boolean().default(true),
  highlighted: z.boolean().optional(),
});

const flowCanvasCardSchema = z.object({
  flowId: z.string(),
  displayName: z.string(),
  status: z.string().optional(),
  steps: z.array(stepSchema),
  highlightedSteps: z.array(z.string()).optional(),
});

type FlowCanvasCardData = z.infer<typeof flowCanvasCardSchema>;
type StepEntry = z.infer<typeof stepSchema>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function stepTypeIcon(type: string): React.ReactNode {
  switch (type) {
    case "trigger":
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case "code":
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case "loop":
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </svg>
      );
    case "router":
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 3h5v5" /><path d="M8 3H3v5" />
          <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
          <path d="m15 9 6-6" />
        </svg>
      );
    default: // piece
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
        </svg>
      );
  }
}

function friendlyPieceName(pieceName?: string): string | null {
  if (!pieceName) return null;
  const match = pieceName.match(/piece-(.+)$/);
  return match ? match[1] : pieceName;
}

// ── Compact Step Node ───────────────────────────────────────────────────────

function StepNode({ step, isHighlighted }: { step: StepEntry; isHighlighted: boolean }) {
  const pieceName = friendlyPieceName(step.pieceName);

  return (
    <div
      className={[
        "rounded-lg border px-3 py-2 bg-card/90 transition-shadow",
        !step.valid ? "border-destructive/30 bg-destructive/5" : "border-border",
        isHighlighted ? "ring-2 ring-amber-400/60 shadow-sm" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-2.5">
        {/* Step number */}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-medium bg-secondary text-secondary-foreground">
          {step.stepNumber}
        </span>

        {/* Type icon */}
        <div className="shrink-0 text-muted-foreground">
          {stepTypeIcon(step.type)}
        </div>

        {/* Name */}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground truncate">{step.displayName}</div>
          {pieceName && (
            <div className="text-[10px] text-muted-foreground truncate">{pieceName}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Edge connector ──────────────────────────────────────────────────────────

function Edge() {
  return (
    <div className="flex flex-col items-center py-0.5">
      <div className="h-4 w-px bg-border" />
      <div className="-mt-0.5 h-2.5 w-2.5 rounded-full border border-border bg-card" />
      <div className="-mt-0.5 h-4 w-px bg-border" />
    </div>
  );
}

// ── View ────────────────────────────────────────────────────────────────────

function FlowCanvasCardView({ state, data }: PluginViewProps<FlowCanvasCardData>) {
  if (state === "tombstone") {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3">
        <div className="text-sm text-muted-foreground">Flow no longer available</div>
      </div>
    );
  }

  const highlightSet = new Set(data.highlightedSteps ?? []);
  // Also check per-step highlighted flag
  const isHighlighted = (step: StepEntry) =>
    step.highlighted || highlightSet.has(step.name);

  const statusDot = data.status === "ENABLED"
    ? "bg-emerald-500"
    : "bg-muted-foreground/40";

  return (
    <div className="rounded-2xl border border-border bg-card/80 overflow-hidden">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className={`h-2 w-2 shrink-0 rounded-full ${statusDot}`} />
          <span className="text-sm font-medium text-foreground truncate">{data.displayName}</span>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {data.steps.length} step{data.steps.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Flow visualization */}
      <div className="px-3.5 py-3 max-h-[400px] overflow-y-auto">
        <div className="flex flex-col items-center">
          {data.steps.map((step, i) => (
            <div key={step.name} className="w-full max-w-[280px]">
              {i > 0 && <Edge />}
              <StepNode step={step} isHighlighted={isHighlighted(step)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Plugin definition ───────────────────────────────────────────────────

export const flowCanvasCardPlugin: MobileClawPlugin<FlowCanvasCardData> = {
  type: "flow_canvas",
  width: "chat",
  parse: (raw) => {
    const parsed = flowCanvasCardSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message || "Invalid flow canvas card payload" };
    }
    return { ok: true, value: parsed.data };
  },
  render: (props) => <FlowCanvasCardView {...props} />,
};
