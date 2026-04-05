"use client";

import { z } from "zod";
import type { MobileClawPlugin, PluginViewProps } from "@mc/lib/plugins/types";

// ── Schema ──────────────────────────────────────────────────────────────────

const runEntrySchema = z.object({
  runId: z.string(),
  flowId: z.string().optional(),
  flowName: z.string(),
  status: z.string(),
  stepsCount: z.number().optional(),
  startTime: z.string().optional(),
  finishTime: z.string().optional(),
  durationMs: z.number().optional(),
  failedStep: z.string().optional(),
});

const flowRunListCardSchema = z.object({
  runs: z.array(runEntrySchema),
  total: z.number().optional(),
});

type FlowRunListCardData = z.infer<typeof flowRunListCardSchema>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms?: number): string | null {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function statusDotClass(status: string): string {
  switch (status) {
    case "RUNNING":
    case "QUEUED":
      return "bg-primary animate-pulse";
    case "SUCCEEDED":
      return "bg-emerald-500";
    case "FAILED":
    case "INTERNAL_ERROR":
    case "TIMEOUT":
      return "bg-destructive";
    case "PAUSED":
      return "bg-amber-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function statusLabel(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── View ────────────────────────────────────────────────────────────────────

function FlowRunListCardView({ state, data, addInputAttachment }: PluginViewProps<FlowRunListCardData>) {
  if (state === "tombstone") {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3">
        <div className="text-sm text-muted-foreground">Runs list no longer available</div>
      </div>
    );
  }

  const { runs, total } = data;
  const hasMore = total && total > runs.length;

  return (
    <div className="rounded-2xl border border-border bg-card/80 overflow-hidden">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-border/60">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0">
            <path d="M12 2v4" /><path d="m16.2 7.8 2.9-2.9" />
            <path d="M18 12h4" /><path d="m16.2 16.2 2.9 2.9" />
            <path d="M12 18v4" /><path d="m4.9 19.1 2.9-2.9" />
            <path d="M2 12h4" /><path d="m4.9 4.9 2.9 2.9" />
          </svg>
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Runs{total ? ` (${total})` : ""}
          </span>
        </div>
      </div>

      {/* List */}
      <div className="max-h-[320px] overflow-y-auto">
        {runs.map((run, i) => (
          <div
            key={run.runId}
            className={`px-3.5 py-2.5 flex items-start gap-3 transition-colors hover:bg-secondary/30 cursor-pointer ${
              i < runs.length - 1 ? "border-b border-border/40" : ""
            }`}
            onClick={() => {
              addInputAttachment?.("flow_run", {
                id: run.runId,
                displayName: run.flowName,
                status: run.status,
              });
            }}
            role="button"
            tabIndex={0}
          >
            <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusDotClass(run.status)}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">{run.flowName}</span>
                <span className="text-[10px] text-muted-foreground">{statusLabel(run.status)}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                {run.startTime && <span>{timeAgo(run.startTime)}</span>}
                {run.durationMs && <span>{formatDuration(run.durationMs)}</span>}
                {run.failedStep && (
                  <span className="text-destructive/80">failed at {run.failedStep}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      {hasMore && (
        <div className="px-3.5 py-2 border-t border-border/60">
          <span className="text-[10px] text-muted-foreground">
            +{total! - runs.length} more
          </span>
        </div>
      )}
    </div>
  );
}

// ── Plugin definition ───────────────────────────────────────────────────

export const flowRunListCardPlugin: MobileClawPlugin<FlowRunListCardData> = {
  type: "flow_run_list_card",
  width: "chat",
  parse: (raw) => {
    const parsed = flowRunListCardSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message || "Invalid run list card payload" };
    }
    return { ok: true, value: parsed.data };
  },
  render: (props) => <FlowRunListCardView {...props} />,
};
