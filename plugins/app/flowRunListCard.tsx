"use client";

import { z } from "zod";

import type {
  MobileClawPlugin,
  PluginViewProps,
} from "@mc/lib/plugins/types";
import {
  formatDuration,
  relativeTimeFromISO,
  isRunError,
} from "@mc/plugins/app/flowRunCard";

/* ── Zod schema ── */

const runItemSchema = z.object({
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
  runs: z.array(runItemSchema),
  total: z.number().optional(),
});

type FlowRunListCardData = z.infer<typeof flowRunListCardSchema>;

/* ── Status helpers ── */

function statusDotClass(status: string): string {
  if (status === "RUNNING" || status === "QUEUED") return "bg-brand-ongoing";
  if (status === "SUCCEEDED") return "bg-brand-success-bg";
  if (isRunError(status)) return "bg-brand-failure";
  if (status === "PAUSED") return "bg-brand-paused-bg";
  return "bg-muted-foreground/40";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "SUCCEEDED")
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-brand-success-text shrink-0"
      >
        <path d="m5 13 4 4L19 7" />
      </svg>
    );
  if (status === "RUNNING" || status === "QUEUED")
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        className="animate-spin text-brand-ongoing shrink-0"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          strokeDasharray="31.4 31.4"
          strokeLinecap="round"
        />
      </svg>
    );
  if (isRunError(status))
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-brand-failure shrink-0"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  if (status === "PAUSED")
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-brand-paused-text shrink-0"
      >
        <rect x="6" y="4" width="4" height="16" rx="1" />
        <rect x="14" y="4" width="4" height="16" rx="1" />
      </svg>
    );
  return null;
}

/* ── Shared inner component ── */

export interface FlowRunListCardInnerProps {
  runs: Array<{
    runId: string;
    flowId?: string;
    flowName: string;
    status: string;
    stepsCount?: number;
    startTime?: string;
    finishTime?: string;
    durationMs?: number;
    failedStep?: string;
  }>;
  total?: number;
  onRunClick?: (runId: string) => void;
}

export function FlowRunListCardInner({
  runs,
  total,
  onRunClick,
}: FlowRunListCardInnerProps) {
  const count = total ?? runs.length;

  return (
    <div className="overflow-hidden rounded-[24px] bg-card border border-border/50 shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
          Flow Runs
        </span>
        <span className="text-[11px] text-muted-foreground/60">
          {count} run{count !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Run items */}
      <div className="divide-y divide-border/40">
        {runs.map((run) => {
          const timeAgo = relativeTimeFromISO(run.startTime ?? run.finishTime);
          const duration = formatDuration(run.durationMs ?? null);

          return (
            <div
              key={run.runId}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/30 cursor-pointer"
              onClick={() => onRunClick?.(run.runId)}
            >
              {/* Status dot */}
              <span
                className={`size-2 rounded-full shrink-0 ${statusDotClass(run.status)}`}
              />

              {/* Name + details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground truncate">
                    {run.flowName}
                  </span>
                  {run.status !== "SUCCEEDED" && (
                    <span
                      className={`shrink-0 text-[9px] font-bold tracking-[0.08em] uppercase ${
                        run.status === "RUNNING" || run.status === "QUEUED"
                          ? "text-brand-ongoing"
                          : isRunError(run.status)
                            ? "text-brand-failure"
                            : run.status === "PAUSED"
                              ? "text-brand-paused-text"
                              : "text-muted-foreground"
                      }`}
                    >
                      {run.status}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                  <span>{duration}</span>
                  {run.stepsCount != null && (
                    <>
                      <span>&middot;</span>
                      <span>{run.stepsCount} steps</span>
                    </>
                  )}
                  {timeAgo && (
                    <>
                      <span>&middot;</span>
                      <span>{timeAgo}</span>
                    </>
                  )}
                </div>
                {run.failedStep && (
                  <p className="text-[10px] text-brand-failure mt-0.5 truncate">
                    Failed at: {run.failedStep}
                  </p>
                )}
              </div>

              {/* Status icon */}
              <StatusIcon status={run.status} />
            </div>
          );
        })}
      </div>

      {/* Show more indicator */}
      {total != null && total > runs.length && (
        <div className="px-5 py-2.5 text-center text-[11px] text-muted-foreground/60 border-t border-border/40">
          +{total - runs.length} more
        </div>
      )}
    </div>
  );
}

/* ── Plugin view ── */

function FlowRunListCardView({
  state,
  data,
  addInputAttachment,
}: PluginViewProps<FlowRunListCardData>) {
  if (state === "tombstone") {
    return (
      <div
        data-testid="flow-run-list-card"
        className="rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3"
      >
        <div className="text-sm text-muted-foreground">
          Flow runs list no longer available.
        </div>
      </div>
    );
  }

  const handleRunClick = (runId: string) => {
    const run = data.runs.find((r) => r.runId === runId);
    addInputAttachment?.("flow_run", {
      id: runId,
      displayName: run?.flowName ?? "Untitled",
      status: run?.status ?? "UNKNOWN",
    });
  };

  return (
    <div data-testid="flow-run-list-card">
      <FlowRunListCardInner
        runs={data.runs}
        total={data.total}
        onRunClick={handleRunClick}
      />
    </div>
  );
}

/* ── Plugin definition ── */

export const flowRunListCardPlugin: MobileClawPlugin<FlowRunListCardData> = {
  type: "flow_run_list_card",
  width: "chat",
  parse: (raw) => {
    const parsed = flowRunListCardSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message || "Invalid flow run list payload",
      };
    }
    return { ok: true, value: parsed.data };
  },
  render: (props) => <FlowRunListCardView {...props} />,
};
