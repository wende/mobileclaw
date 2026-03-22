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

const flowRunDetailCardSchema = z.object({
  runId: z.string(),
  flowId: z.string(),
  flowName: z.string().optional(),
  status: z.string(),
  startTime: z.string().optional(),
  finishTime: z.string().optional(),
  durationMs: z.number().optional(),
  failedStep: z.string().nullable().optional(),
  steps: z.record(
    z.string(),
    z.object({
      status: z.string(),
      errorMessage: z.string().optional(),
    }),
  ),
});

type FlowRunDetailCardData = z.infer<typeof flowRunDetailCardSchema>;

/* ── Status helpers ── */

function stepDotClass(status: string): string {
  if (status === "SUCCEEDED") return "bg-brand-success-bg";
  if (status === "RUNNING") return "bg-brand-ongoing";
  if (isRunError(status)) return "bg-brand-failure";
  if (status === "PAUSED") return "bg-brand-paused-bg";
  return "bg-muted-foreground/30";
}

function stepLineClass(status: string): string {
  if (status === "SUCCEEDED") return "bg-brand-success-bg/40";
  if (isRunError(status)) return "bg-brand-failure/40";
  return "bg-border";
}

function overallStatusBadge(status: string): { text: string; className: string } {
  if (status === "SUCCEEDED")
    return { text: "Succeeded", className: "bg-brand-success-bg/30 text-brand-success-text" };
  if (status === "RUNNING" || status === "QUEUED")
    return { text: "Running", className: "bg-brand-ongoing/20 text-brand-ongoing" };
  if (isRunError(status))
    return { text: status === "FAILED" ? "Failed" : status, className: "bg-brand-failure/20 text-brand-failure" };
  if (status === "PAUSED")
    return { text: "Paused", className: "bg-brand-paused-bg/30 text-brand-paused-text" };
  return { text: status, className: "bg-secondary text-muted-foreground" };
}

/* ── Shared inner component ── */

export interface FlowRunDetailCardInnerProps {
  runId: string;
  flowName?: string;
  status: string;
  startTime?: string;
  finishTime?: string;
  durationMs?: number;
  failedStep?: string | null;
  steps: Record<string, { status: string; errorMessage?: string }>;
  onClick?: () => void;
}

export function FlowRunDetailCardInner({
  flowName,
  status,
  startTime,
  finishTime,
  durationMs,
  failedStep,
  steps,
  onClick,
}: FlowRunDetailCardInnerProps) {
  const badge = overallStatusBadge(status);
  const timeAgo = relativeTimeFromISO(startTime ?? finishTime);
  const duration = formatDuration(durationMs ?? null);
  const stepEntries = Object.entries(steps);

  return (
    <div
      className="overflow-hidden rounded-[24px] bg-card border border-border/50 shadow-[0_8px_24px_rgba(0,0,0,0.06)] cursor-pointer hover:shadow-[0_12px_32px_rgba(0,0,0,0.1)] hover:-translate-y-0.5 transition-all duration-300"
      onClick={onClick}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-foreground">
            {flowName?.trim() || "Untitled workflow"}
          </span>
          <span
            className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.08em] uppercase ${badge.className}`}
          >
            {badge.text}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{duration}</span>
          {timeAgo && (
            <>
              <span>&middot;</span>
              <span>{timeAgo}</span>
            </>
          )}
          <span>&middot;</span>
          <span>{stepEntries.length} steps</span>
        </div>
      </div>

      {/* Step timeline */}
      {stepEntries.length > 0 && (
        <div className="px-5 pb-4">
          <div className="relative">
            {stepEntries.map(([name, step], i) => {
              const isLast = i === stepEntries.length - 1;
              const isFailed = name === failedStep;

              return (
                <div key={name} className="flex gap-3 relative">
                  {/* Connector line + dot */}
                  <div className="flex flex-col items-center shrink-0 w-3">
                    <span
                      className={`size-2.5 rounded-full shrink-0 mt-1 ${stepDotClass(step.status)}${
                        step.status === "RUNNING" ? " animate-pulse" : ""
                      }`}
                    />
                    {!isLast && (
                      <span
                        className={`w-px flex-1 min-h-3 ${stepLineClass(step.status)}`}
                      />
                    )}
                  </div>

                  {/* Step info */}
                  <div className={`flex-1 min-w-0 pb-2.5 ${isLast ? "pb-0" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[12px] font-medium truncate ${
                          isFailed ? "text-brand-failure" : "text-foreground"
                        }`}
                      >
                        {name}
                      </span>
                      {step.status !== "SUCCEEDED" && (
                        <span
                          className={`text-[9px] font-bold tracking-[0.06em] uppercase ${
                            isRunError(step.status)
                              ? "text-brand-failure"
                              : step.status === "RUNNING"
                                ? "text-brand-ongoing"
                                : "text-muted-foreground"
                          }`}
                        >
                          {step.status}
                        </span>
                      )}
                    </div>
                    {isFailed && step.errorMessage && (
                      <p className="text-[10px] text-brand-failure/80 mt-0.5 line-clamp-2">
                        {step.errorMessage}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Plugin view ── */

function FlowRunDetailCardView({
  state,
  data,
  addInputAttachment,
}: PluginViewProps<FlowRunDetailCardData>) {
  if (state === "tombstone") {
    return (
      <div
        data-testid="flow-run-detail-card"
        className="rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3"
      >
        <div className="text-sm text-muted-foreground">
          Run detail no longer available.
        </div>
      </div>
    );
  }

  const handleClick = () => {
    addInputAttachment?.("flow_run", {
      id: data.runId,
      displayName: data.flowName?.trim() || "Untitled",
      status: data.status,
    });
  };

  return (
    <div data-testid="flow-run-detail-card">
      <FlowRunDetailCardInner
        runId={data.runId}
        flowName={data.flowName}
        status={data.status}
        startTime={data.startTime}
        finishTime={data.finishTime}
        durationMs={data.durationMs}
        failedStep={data.failedStep}
        steps={data.steps}
        onClick={handleClick}
      />
    </div>
  );
}

/* ── Plugin definition ── */

export const flowRunDetailCardPlugin: MobileClawPlugin<FlowRunDetailCardData> = {
  type: "flow_run_detail_card",
  width: "chat",
  parse: (raw) => {
    const parsed = flowRunDetailCardSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message || "Invalid flow run detail payload",
      };
    }
    return { ok: true, value: parsed.data };
  },
  render: (props) => <FlowRunDetailCardView {...props} />,
};
