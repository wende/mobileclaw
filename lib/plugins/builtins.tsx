"use client";

import { useEffect, useMemo, useState } from "react";

import { z } from "zod";

import type { PluginAction, PluginActionStyle } from "@/types/chat";
import type { AnyMobileClawPlugin, MobileClawPlugin, PluginParseResult, PluginViewProps } from "@/lib/plugins/types";

const pluginStyleSchema = z.enum(["primary", "secondary", "destructive"]);

const pluginActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  style: pluginStyleSchema.optional(),
  request: z.union([
    z.object({
      kind: z.literal("http"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      url: z.string().url(),
      body: z.record(z.string(), z.unknown()).optional(),
      headers: z.record(z.string(), z.string()).optional(),
      fireAndForget: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal("ws"),
      method: z.string(),
      params: z.record(z.string(), z.unknown()).optional(),
    }),
  ]),
});

function toParseResult<T>(result: z.SafeParseReturnType<unknown, T>): PluginParseResult<T> {
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues[0]?.message || "Invalid plugin payload" };
}

function frameClass(state: "pending" | "active" | "settled" | "tombstone") {
  if (state === "tombstone") {
    return "rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3";
  }
  return "rounded-2xl border border-border bg-card/80 px-3.5 py-3";
}

function statePillClass(style: PluginActionStyle | "neutral") {
  if (style === "primary") {
    return "border border-primary/20 bg-primary/10 text-primary";
  }
  if (style === "destructive") {
    return "border border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (style === "secondary") {
    return "border border-border bg-secondary text-secondary-foreground";
  }
  return "border border-border bg-background/60 text-muted-foreground";
}

function statusTone(status: StatusCardData["status"]): PluginActionStyle | "neutral" {
  if (status === "running") return "primary";
  if (status === "succeeded") return "secondary";
  if (status === "failed" || status === "stopped") return "destructive";
  return "neutral";
}

function formatDuration(ms?: number): string | null {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const statusCardSchema = z.object({
  label: z.string(),
  status: z.enum(["pending", "running", "succeeded", "failed", "stopped"]),
  startedAt: z.number().optional(),
  duration: z.number().optional(),
  detail: z.string().optional(),
});

type StatusCardData = z.infer<typeof statusCardSchema>;

function StatusCardView({ state, data }: PluginViewProps<StatusCardData>) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state !== "active" || !data.startedAt || data.duration) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data.duration, data.startedAt, state]);

  const durationLabel = useMemo(() => {
    if (state === "tombstone") return null;
    const durationMs = data.duration ?? (state === "active" && data.startedAt ? Math.max(0, now - data.startedAt) : undefined);
    return formatDuration(durationMs);
  }, [data.duration, data.startedAt, now, state]);

  if (state === "tombstone") {
    return (
      <div data-testid="status-card" className={frameClass(state)}>
        <div className="text-sm font-medium text-foreground">{data.label}</div>
        <div className="mt-1 text-xs text-muted-foreground">This item is no longer available.</div>
      </div>
    );
  }

  return (
    <div data-testid="status-card" className={frameClass(state)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary/80" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{data.label}</div>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${statePillClass(statusTone(data.status))}`}>
              {data.status}
            </span>
          </div>
          {data.detail && (
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {data.detail}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className={`inline-flex items-center gap-1 ${state === "active" ? "text-primary" : ""}`}>
              {state === "pending" && (
                <svg width="12" height="12" viewBox="0 0 24 24" className="animate-spin">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                </svg>
              )}
              {state === "active" && (
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              )}
              <span>{state}</span>
            </span>
            {durationLabel && <span>{durationLabel}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

const pauseOptionSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  value: z.string(),
  style: pluginStyleSchema.optional(),
  actionId: z.string().optional(),
  action: pluginActionSchema.optional(),
});

const pauseCardSchema = z.object({
  prompt: z.string(),
  options: z.array(pauseOptionSchema).min(1),
  actions: z.array(pluginActionSchema).optional(),
  resumeUrl: z.string().url().optional(),
  expiresAt: z.number().optional(),
  selectedLabel: z.string().optional(),
  selectedValue: z.string().optional(),
  submitted: z.object({
    label: z.string().optional(),
    value: z.string().optional(),
  }).optional(),
});

type PauseCardInput = z.infer<typeof pauseCardSchema>;

type PauseCardOption = {
  id: string;
  label: string;
  value: string;
  style?: PluginActionStyle;
  action: PluginAction;
};

type PauseCardData = {
  prompt: string;
  options: PauseCardOption[];
  expiresAt?: number;
  selectedLabel?: string;
  selectedValue?: string;
};

function normalizePauseCardData(raw: PauseCardInput): PluginParseResult<PauseCardData> {
  const actionsById = new Map((raw.actions || []).map((action) => [action.id, action]));

  const options: PauseCardOption[] = [];
  for (let index = 0; index < raw.options.length; index++) {
    const option = raw.options[index];
    const optionId = option.id || `option-${index}`;
    let action = option.action || (option.actionId ? actionsById.get(option.actionId) : undefined);

    if (!action && raw.resumeUrl) {
      action = {
        id: `resume-${optionId}`,
        label: option.label,
        style: option.style,
        request: {
          kind: "http",
          method: "POST",
          url: raw.resumeUrl,
          body: { value: option.value },
        },
      };
    }

    if (!action) {
      return { ok: false, error: `Missing action for pause option "${option.label}"` };
    }

    options.push({
      id: optionId,
      label: option.label,
      value: option.value,
      style: option.style,
      action,
    });
  }

  return {
    ok: true,
    value: {
      prompt: raw.prompt,
      options,
      expiresAt: raw.expiresAt,
      selectedLabel: raw.submitted?.label || raw.selectedLabel,
      selectedValue: raw.submitted?.value || raw.selectedValue,
    },
  };
}

function optionToneClass(style: PluginActionStyle | undefined) {
  if (style === "primary") return "text-primary";
  if (style === "destructive") return "text-destructive";
  return "text-muted-foreground";
}

function PauseCardView({ state, data, invokeAction }: PluginViewProps<PauseCardData>) {
  const [now, setNow] = useState(() => Date.now());
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [localSubmittedId, setLocalSubmittedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedOption = data.options.find((option) =>
    option.id === localSubmittedId
    || (data.selectedValue && option.value === data.selectedValue)
    || (data.selectedLabel && option.label === data.selectedLabel),
  );
  const expired = !!data.expiresAt && data.expiresAt <= now;
  const isLocked = expired || state === "tombstone" || (!!selectedOption && !error);
  const stateLabel = expired ? "expired" : state === "settled" && selectedOption ? "recorded" : state;
  const showHeaderSpinner = !selectedOption && !error && state === "active" && !expired;

  useEffect(() => {
    if (!data.expiresAt || expired || state === "tombstone" || !!selectedOption) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data.expiresAt, expired, selectedOption?.id, state]);

  useEffect(() => {
    if (data.selectedValue || data.selectedLabel || state === "settled") {
      setError(null);
      setSubmittingId(null);
    }
  }, [data.selectedLabel, data.selectedValue, state]);

  if (state === "tombstone") {
    return (
      <div data-testid="pause-card" className={frameClass(state)}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-destructive">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Approval prompt</div>
            <div className="mt-1 text-sm font-medium text-foreground">Action expired</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">This prompt is no longer available.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="pause-card" className={frameClass(state)}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center ${
          showHeaderSpinner
            ? "text-muted-foreground"
            : expired
              ? "text-destructive"
              : selectedOption
                ? "text-primary"
                : "text-muted-foreground"
        }`}>
          {selectedOption && !error ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          ) : showHeaderSpinner ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : expired ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v6" />
              <path d="M12 21v-4" />
              <path d="M5.64 5.64 9.88 9.88" />
              <path d="m14.12 14.12 4.24 4.24" />
              <path d="M3 12h6" />
              <path d="M21 12h-4" />
              <path d="m5.64 18.36 4.24-4.24" />
              <path d="m14.12 9.88 4.24-4.24" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Approval prompt</div>
              <div className="mt-1 text-sm font-medium text-foreground">Awaiting your input</div>
            </div>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${statePillClass(expired ? "destructive" : state === "active" ? "primary" : "neutral")}`}>
              {stateLabel}
            </span>
          </div>
          <div className="mt-2 text-sm leading-6 text-foreground">
            {data.prompt}
          </div>
        </div>
      </div>
      <div className="mt-3 border-t border-border/80 pt-3">
        {selectedOption && !error ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                <path d="m5 13 4 4L19 7" />
              </svg>
              {selectedOption.label}
            </span>
            <span>Response recorded for the agent.</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">Choose one path to let the run continue.</div>
            {expired ? (
              <span className="text-xs text-destructive">This prompt has expired.</span>
            ) : (
              <span className="text-xs text-muted-foreground">One selection only.</span>
            )}
          </div>
        )}
      </div>
      {error && (
        <div className="mt-3 border-t border-destructive/20 pt-3 text-xs leading-5 text-destructive">
          {error}
        </div>
      )}
      <div className="mt-3 -mx-3.5 border-t border-border/80">
        {data.options.map((option) => {
          const isSubmitting = submittingId === option.id;
          const isSelected = selectedOption?.id === option.id && !error;
          const showOptionSpinner = isSubmitting;
          const isDisabled = isLocked || !!submittingId;
          return (
            <button
              key={option.id}
              type="button"
              disabled={isDisabled}
              onClick={async () => {
                setSubmittingId(option.id);
                setError(null);
                try {
                  await invokeAction(option.action, {
                    selectedLabel: option.label,
                    selectedValue: option.value,
                  });
                  setLocalSubmittedId(option.id);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Unable to submit selection.");
                } finally {
                  setSubmittingId(null);
                }
              }}
              className={[
                "group w-full border-t border-border/70 px-3.5 py-3 text-left text-sm font-medium transition-colors first:border-t-0 disabled:cursor-not-allowed disabled:opacity-60",
                isSelected ? "bg-secondary/70" : "",
                !isDisabled ? "hover:bg-secondary/45" : "",
              ].join(" ")}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center ${
                  showOptionSpinner
                    ? "text-muted-foreground"
                    : isSelected
                      ? "text-primary"
                      : optionToneClass(option.style)
                }`}>
                  {showOptionSpinner ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : isSelected ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                  ) : option.style === "destructive" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18" />
                      <path d="M6 6l12 12" />
                    </svg>
                  ) : option.style === "primary" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="8" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{option.label}</span>
                    {isSelected && (
                      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Selected</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {isSubmitting
                      ? "Sending your choice to the agent."
                      : isSelected
                        ? "This response has been recorded."
                        : option.style === "destructive"
                          ? "Stop the current path."
                          : option.style === "primary"
                            ? "Continue immediately."
                            : "Pause here for review."}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const statusCardPlugin: MobileClawPlugin<StatusCardData> = {
  type: "status_card",
  parse: (raw) => toParseResult(statusCardSchema.safeParse(raw)),
  render: (props) => <StatusCardView {...props} />,
};

export const pauseCardPlugin: MobileClawPlugin<PauseCardData> = {
  type: "pause_card",
  width: "chat",
  parse: (raw) => {
    const parsed = pauseCardSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message || "Invalid plugin payload" };
    }
    return normalizePauseCardData(parsed.data);
  },
  render: (props) => <PauseCardView {...props} />,
};

export const builtinPlugins: AnyMobileClawPlugin[] = [
  statusCardPlugin,
  pauseCardPlugin,
];
