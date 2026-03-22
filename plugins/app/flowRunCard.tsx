"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import { z } from "zod";

import type {
  MobileClawPlugin,
  PluginViewProps,
} from "@mc/lib/plugins/types";

/* ── Zod schema ── */

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

/* ── Shared helpers (exported for sidebar reuse) ── */

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "\u2014";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.round(ms / 1_000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTimeFromISO(isoDate: string | undefined): string {
  if (!isoDate) return "";
  const diffMs = new Date(isoDate).getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  if (absMs < 60_000) return rtf.format(Math.round(diffMs / 1_000), "second");
  if (absMs < 3_600_000)
    return rtf.format(Math.round(diffMs / 60_000), "minute");
  if (absMs < 86_400_000)
    return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  return rtf.format(Math.round(diffMs / 86_400_000), "day");
}

export function isRunError(status: string): boolean {
  return (
    status === "FAILED" ||
    status === "INTERNAL_ERROR" ||
    status === "TIMEOUT" ||
    status === "QUOTA_EXCEEDED" ||
    status === "MEMORY_LIMIT_EXCEEDED" ||
    status === "LOG_SIZE_EXCEEDED" ||
    status === "CANCELED"
  );
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

export function resolveDurationMs(run: {
  startTime?: string;
  finishTime?: string;
  duration?: number | null;
}): number | null {
  const startMs = run.startTime
    ? new Date(run.startTime).getTime()
    : null;
  const finishMs = run.finishTime
    ? new Date(run.finishTime).getTime()
    : null;
  if (startMs && finishMs && finishMs >= startMs) return finishMs - startMs;
  if (
    typeof run.duration === "number" &&
    Number.isFinite(run.duration) &&
    run.duration >= 0
  )
    return run.duration;
  return null;
}

function useElapsedSeconds(
  startTime: string | undefined,
  active: boolean,
): number {
  const [elapsed, setElapsed] = useState(() => {
    if (!startTime) return 0;
    return Math.max(
      0,
      Math.round((Date.now() - new Date(startTime).getTime()) / 1_000),
    );
  });
  useEffect(() => {
    if (!active || !startTime) return;
    const id = window.setInterval(() => {
      setElapsed(
        Math.max(
          0,
          Math.round((Date.now() - new Date(startTime).getTime()) / 1_000),
        ),
      );
    }, 1_000);
    return () => window.clearInterval(id);
  }, [active, startTime]);
  return elapsed;
}

/* ── Shared inner component ── */

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
}: FlowRunCardInnerProps) {
  const isRunning = status === "RUNNING" || status === "QUEUED";
  const isSuccess = status === "SUCCEEDED";
  const isError = isRunError(status);
  const elapsed = useElapsedSeconds(startTime, isRunning);
  const timeAgo = relativeTimeFromISO(startTime ?? finishTime);
  const duration = formatDuration(durationMs ?? null);

  if (isRunning) {
    return (
      <div
        className="bg-card rounded-2xl p-5 shadow-[0_4px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 cursor-pointer"
        style={highlightStyle}
        onClick={onClick}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-ongoing opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-brand-ongoing" />
          </span>
          <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-foreground">
            {flowName}
          </span>
          <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-brand-ongoing">
            Running
          </span>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            className="animate-spin text-foreground shrink-0"
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
          <span>
            Processing{stepsCount ? ` (${stepsCount} steps)` : ""}...
          </span>
        </div>
        <div className="mt-3 pt-3 border-t border-border flex justify-between items-center">
          <span className="text-[11px] text-muted-foreground">
            {timeAgo || "just now"}
          </span>
          <span className="text-[12px] font-mono text-muted-foreground">
            {elapsed}s
          </span>
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div
        className="bg-card rounded-2xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 cursor-pointer"
        style={highlightStyle}
        onClick={onClick}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="size-2 rounded-full bg-brand-success-bg shrink-0" />
          <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-foreground">
            {flowName}
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-brand-success-text shrink-0"
          >
            <path d="m5 13 4 4L19 7" />
          </svg>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {stepsCount != null && (
            <>
              <span>{stepsCount} steps</span>
              <span>&middot;</span>
            </>
          )}
          <span>{duration}</span>
          {timeAgo && (
            <>
              <span>&middot;</span>
              <span>{timeAgo}</span>
            </>
          )}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="bg-card rounded-2xl p-4 border border-brand-failure/50 shadow-[0_4px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 cursor-pointer"
        style={highlightStyle}
        onClick={onClick}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="size-2 rounded-full bg-brand-failure shrink-0" />
          <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-foreground">
            {flowName}
          </span>
          <svg
            width="14"
            height="14"
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
        </div>
        {failedStep && (
          <p className="text-[11px] text-[#C46C78] mb-2">
            Failed at: {failedStep}
          </p>
        )}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {stepsCount != null && (
            <>
              <span>{stepsCount} steps</span>
              <span>&middot;</span>
            </>
          )}
          <span>{duration}</span>
          {timeAgo && (
            <>
              <span>&middot;</span>
              <span>{timeAgo}</span>
            </>
          )}
        </div>
      </div>
    );
  }

  // Other statuses (PAUSED, SCHEDULED, etc.)
  return (
    <div
      className="bg-card rounded-2xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 cursor-pointer"
      style={highlightStyle}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="size-2 rounded-full bg-brand-paused-bg shrink-0" />
        <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-foreground">
          {flowName}
        </span>
        <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-brand-paused-text">
          {status}
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
      </div>
    </div>
  );
}

/* ── Plugin view (wraps inner with plugin infrastructure) ── */

function FlowRunCardView({
  state,
  data,
  addInputAttachment,
}: PluginViewProps<FlowRunCardData>) {
  if (state === "tombstone") {
    return (
      <div
        data-testid="flow-run-card"
        className="rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3"
      >
        <div className="text-sm text-muted-foreground">
          Run no longer available.
        </div>
      </div>
    );
  }

  const handleClick = () => {
    addInputAttachment?.("flow_run", {
      id: data.runId,
      displayName: data.flowName,
      status: data.status,
    });
  };

  return (
    <div data-testid="flow-run-card">
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
    </div>
  );
}

/* ── Plugin definition ── */

export const flowRunCardPlugin: MobileClawPlugin<FlowRunCardData> = {
  type: "flow_run_card",
  width: "chat",
  parse: (raw) => {
    const parsed = flowRunCardSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message || "Invalid flow run payload",
      };
    }
    return { ok: true, value: parsed.data };
  },
  render: (props) => <FlowRunCardView {...props} />,
};
