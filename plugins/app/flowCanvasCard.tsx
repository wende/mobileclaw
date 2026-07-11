"use client";

import type { ReactNode } from "react";
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

function resolveIconColors(type: string, valid: boolean): { color: string; bg: string } {
  if (!valid) return { color: "text-destructive", bg: "bg-destructive/10" };
  if (type === "trigger") return { color: "text-purple-600", bg: "bg-purple-100" };
  if (type === "router") return { color: "text-gray-600", bg: "bg-gray-100" };
  if (type === "loop") return { color: "text-indigo-600", bg: "bg-indigo-100" };
  if (type === "code") return { color: "text-emerald-600", bg: "bg-emerald-100" };
  return { color: "text-blue-600", bg: "bg-blue-100" };
}

function stepTypeIcon(type: string): ReactNode {
  switch (type) {
    case "trigger":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case "code":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case "loop":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </svg>
      );
    case "router":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 3h5v5" /><path d="M8 3H3v5" />
          <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
          <path d="m15 9 6-6" />
        </svg>
      );
    default: // piece
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
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

// ── Step Node ───────────────────────────────────────────────────────────────

function StepNode({ step, isHighlighted }: { step: StepEntry; isHighlighted: boolean }) {
  const pieceName = friendlyPieceName(step.pieceName);
  const { color, bg } = resolveIconColors(step.type, step.valid);
  const isTrigger = step.type === "trigger";

  return (
    <div className="relative">
      {isTrigger && (
        <div className="absolute -top-2.5 left-3 z-10 flex items-center gap-0.5 rounded-full border border-border bg-card px-1.5 py-px text-[9px] font-semibold text-muted-foreground shadow-sm">
          <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Trigger
        </div>
      )}
      <div
        className={[
          "rounded-[6px] border px-2 py-1.5 bg-card transition-shadow",
          !step.valid ? "border-destructive/30 bg-destructive/5" : "border-border",
          isHighlighted ? "ring-1 ring-amber-400/60" : "",
        ].join(" ")}
      >
        <div className="flex items-center gap-2">
          {/* Colored icon box */}
          <div className={`h-6 w-6 shrink-0 rounded ${bg} ${color} flex items-center justify-center`}>
            {stepTypeIcon(step.type)}
          </div>

          {/* Name + piece */}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-foreground truncate leading-tight">
              {step.stepNumber}. {step.displayName}
            </div>
            {pieceName && (
              <div className="text-[10px] text-muted-foreground truncate leading-tight">{pieceName}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Edge connector ──────────────────────────────────────────────────────────

function Edge() {
  return (
    <div className="flex flex-col items-center">
      <div className="h-3 w-px bg-border" />
      <div className="-mt-px z-10 h-2 w-2 rounded-full border border-border bg-card" />
      <div className="-mt-px h-3 w-px bg-border" />
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
    ? "bg-success"
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
      <div className="px-3.5 pt-3 pb-5">
        <div className="flex flex-col items-center">
          {data.steps.map((step, i) => (
            <div key={step.name} className="w-full max-w-[240px]">
              {i > 0 && <Edge />}
              <div className={step.type === "trigger" ? "mt-2.5" : ""}>
                <StepNode step={step} isHighlighted={isHighlighted(step)} />
              </div>
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
