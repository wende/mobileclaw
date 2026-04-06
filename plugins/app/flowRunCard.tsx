"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import type { MobileClawPlugin, PluginViewProps } from "@mc/lib/plugins/types";

// ── Schema ──────────────────────────────────────────────────────────────────

const flowRunCardSchema = z.object({
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

type FlowRunCardData = z.infer<typeof flowRunCardSchema>;

// ── Helpers (exported for 8claw sidebar reuse) ──────────────────────────

export function resolveDurationMs(run: {
  startTime?: string | null;
  finishTime?: string | null;
  duration?: number | null;
}): number | null {
  const start = run.startTime ? new Date(run.startTime).getTime() : null;
  const finish = run.finishTime ? new Date(run.finishTime).getTime() : null;
  if (start && finish && finish >= start) return finish - start;
  if (typeof run.duration === "number" && run.duration >= 0) return run.duration;
  return null;
}

export function resolveFailedStep(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.displayName === "string") return obj.displayName;
    if (typeof obj.name === "string") return obj.name;
  }
  return null;
}

function formatDuration(ms?: number | null): string | null {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function statusColor(status: string): string {
  switch (status) {
    case "RUNNING":
    case "QUEUED":
      return "text-primary";
    case "SUCCEEDED":
      return "text-success";
    case "FAILED":
    case "INTERNAL_ERROR":
    case "TIMEOUT":
      return "text-destructive";
    case "PAUSED":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

function statusBgClass(status: string): string {
  switch (status) {
    case "RUNNING":
    case "QUEUED":
      return "border-primary/20 bg-primary/10 text-primary";
    case "SUCCEEDED":
      return "border-brand-success-bg bg-brand-success-bg/30 text-brand-success-text";
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

function statusDotClass(status: string): string {
  switch (status) {
    case "RUNNING":
    case "QUEUED":
      return "bg-primary animate-pulse";
    case "SUCCEEDED":
      return "bg-success";
    case "FAILED":
    case "INTERNAL_ERROR":
    case "TIMEOUT":
      return "bg-destructive";
    case "PAUSED":
      return "bg-amber-500";
    default:
      return "bg-muted-foreground";
  }
}

// ── FlowRunCardInner (standalone export for 8claw sidebar) ──────────────

export interface FlowRunCardInnerProps {
  flowName: string;
  status: string;
  stepsCount?: number;
  startTime?: string;
  finishTime?: string;
  durationMs?: number;
  failedStep?: string;
  onClick?: () => void;
  highlightStyle?: CSSProperties;
  className?: string;
}

export function FlowRunCardInner({
  flowName,
  status,
  stepsCount,
  startTime,
  finishTime,
  durationMs,
  failedStep,
  onClick,
  highlightStyle,
  className,
}: FlowRunCardInnerProps) {
  const [now, setNow] = useState(() => Date.now());
  const isRunning = status === "RUNNING" || status === "QUEUED";

  useEffect(() => {
    if (!isRunning || !startTime) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, startTime]);

  const durationLabel = useMemo(() => {
    if (durationMs) return formatDuration(durationMs);
    if (isRunning && startTime) {
      return formatDuration(Math.max(0, now - new Date(startTime).getTime()));
    }
    if (startTime && finishTime) {
      return formatDuration(new Date(finishTime).getTime() - new Date(startTime).getTime());
    }
    return null;
  }, [durationMs, isRunning, startTime, finishTime, now]);

  return (
    <div
      className={className ?? "rounded-2xl border border-border bg-card/80 p-3 transition-shadow"}
      style={highlightStyle}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(status)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{flowName}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] border ${statusBgClass(status)}`}>
              {status}
            </span>
          </div>

          {failedStep && (
            <div className="mt-1 text-xs text-destructive/80">
              Failed at: {failedStep}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {durationLabel && (
              <span className={`inline-flex items-center gap-1 ${isRunning ? statusColor(status) : ""}`}>
                {isRunning && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
                {durationLabel}
              </span>
            )}
            {typeof stepsCount === "number" && stepsCount > 0 && (
              <span>{stepsCount} step{stepsCount !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Plugin view ─────────────────────────────────────────────────────────

function FlowRunCardView({ state, data, addInputAttachment }: PluginViewProps<FlowRunCardData>) {
  const handleClick = () => {
    addInputAttachment?.("flow_run", {
      id: data.runId,
      displayName: data.flowName,
      status: data.status,
    });
  };

  if (state === "tombstone") {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 p-3">
        <div className="text-sm text-muted-foreground">Run no longer available</div>
      </div>
    );
  }

  return (
    <FlowRunCardInner
      flowName={data.flowName}
      status={data.status}
      stepsCount={data.stepsCount}
      startTime={data.startTime}
      finishTime={data.finishTime}
      durationMs={data.durationMs}
      failedStep={data.failedStep}
      onClick={handleClick}
    />
  );
}

// ── Plugin definition ───────────────────────────────────────────────────

export const flowRunCardPlugin: MobileClawPlugin<FlowRunCardData> = {
  type: "flow_run_card",
  width: "chat",
  parse: (raw) => {
    const parsed = flowRunCardSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message || "Invalid flow run card payload" };
    }
    return { ok: true, value: parsed.data };
  },
  render: (props) => <FlowRunCardView {...props} />,
};
