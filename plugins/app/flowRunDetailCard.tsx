"use client";

import { z } from "zod";
import type { MobileClawPlugin, PluginViewProps } from "@mc/lib/plugins/types";

// ── Schema ──────────────────────────────────────────────────────────────────

const stepInfoSchema = z.object({
  status: z.string().optional(),
  errorMessage: z.string().optional(),
});

const flowRunDetailCardSchema = z.object({
  runId: z.string(),
  flowId: z.string().optional(),
  flowName: z.string(),
  status: z.string(),
  startTime: z.string().optional(),
  finishTime: z.string().optional(),
  durationMs: z.number().optional(),
  failedStep: z.string().nullable().optional(),
  steps: z.record(z.string(), stepInfoSchema).optional(),
});

type FlowRunDetailCardData = z.infer<typeof flowRunDetailCardSchema>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms?: number): string | null {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function statusBgClass(status: string): string {
  switch (status) {
    case "RUNNING":
    case "QUEUED":
      return "border-primary/20 bg-primary/10 text-primary";
    case "SUCCEEDED":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "FAILED":
    case "INTERNAL_ERROR":
    case "TIMEOUT":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    case "PAUSED":
      return "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    default:
      return "border-border bg-background/60 text-muted-foreground";
  }
}

function stepStatusIcon(status?: string): { color: string; icon: React.ReactNode } {
  switch (status) {
    case "SUCCEEDED":
      return {
        color: "text-emerald-500",
        icon: (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 13 4 4L19 7" />
          </svg>
        ),
      };
    case "FAILED":
      return {
        color: "text-destructive",
        icon: (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" /><path d="M6 6l12 12" />
          </svg>
        ),
      };
    case "RUNNING":
      return {
        color: "text-primary",
        icon: <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />,
      };
    default:
      return {
        color: "text-muted-foreground",
        icon: <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />,
      };
  }
}

// ── View ────────────────────────────────────────────────────────────────────

function FlowRunDetailCardView({ state, data }: PluginViewProps<FlowRunDetailCardData>) {
  if (state === "tombstone") {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3">
        <div className="text-sm text-muted-foreground">Run details no longer available</div>
      </div>
    );
  }

  const stepEntries = data.steps ? Object.entries(data.steps) : [];
  const durationLabel = formatDuration(data.durationMs);

  return (
    <div className="rounded-2xl border border-border bg-card/80 overflow-hidden">
      {/* Header */}
      <div className="px-3.5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{data.flowName}</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] border ${statusBgClass(data.status)}`}>
            {data.status}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
          {durationLabel && <span>{durationLabel}</span>}
          {stepEntries.length > 0 && <span>{stepEntries.length} steps</span>}
          {data.failedStep && (
            <span className="text-destructive/80">failed at {data.failedStep}</span>
          )}
        </div>
      </div>

      {/* Steps timeline */}
      {stepEntries.length > 0 && (
        <div className="border-t border-border/60 px-3.5 py-2.5 max-h-[200px] overflow-y-auto">
          {stepEntries.map(([name, info]) => {
            const { color, icon } = stepStatusIcon(info.status);
            const isFailed = name === data.failedStep;
            return (
              <div key={name} className="flex items-start gap-2.5 py-1">
                <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center ${color}`}>
                  {icon}
                </div>
                <div className="min-w-0 flex-1">
                  <span className={`text-xs ${isFailed ? "text-destructive font-medium" : "text-foreground"}`}>
                    {name}
                  </span>
                  {isFailed && info.errorMessage && (
                    <div className="mt-0.5 text-[10px] text-destructive/70 leading-4 line-clamp-2">
                      {info.errorMessage}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Plugin definition ───────────────────────────────────────────────────

export const flowRunDetailCardPlugin: MobileClawPlugin<FlowRunDetailCardData> = {
  type: "flow_run_detail_card",
  width: "chat",
  parse: (raw) => {
    const parsed = flowRunDetailCardSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message || "Invalid run detail card payload" };
    }
    return { ok: true, value: parsed.data };
  },
  render: (props) => <FlowRunDetailCardView {...props} />,
};
