"use client";

import { useEffect, useMemo, useState } from "react";

import { z } from "zod";

import type { PluginAction, PluginActionStyle } from "@mc/types/chat";
import type {
  MobileClawPlugin,
  PluginParseResult,
  PluginViewProps,
} from "@mc/lib/plugins/types";

/* ── Zod schema (mirrors builtin) ── */

const pluginActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  style: z.enum(["primary", "secondary", "destructive"]).optional(),
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

const pauseOptionSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  value: z.string(),
  style: z.enum(["primary", "secondary", "destructive"]).optional(),
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
  submitted: z
    .object({
      label: z.string().optional(),
      value: z.string().optional(),
    })
    .optional(),
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

/* ── Normalize ── */

function normalizePauseCardData(
  raw: PauseCardInput,
): PluginParseResult<PauseCardData> {
  const actionsById = new Map(
    (raw.actions || []).map((a) => [a.id, a]),
  );

  const options: PauseCardOption[] = [];
  for (let i = 0; i < raw.options.length; i++) {
    const opt = raw.options[i];
    const optionId = opt.id || `option-${i}`;
    let action =
      opt.action ||
      (opt.actionId ? actionsById.get(opt.actionId) : undefined);

    if (!action && raw.resumeUrl) {
      action = {
        id: `resume-${optionId}`,
        label: opt.label,
        style: opt.style,
        request: {
          kind: "http" as const,
          method: "POST" as const,
          url: raw.resumeUrl,
          body: { value: opt.value },
        },
      };
    }

    if (!action) {
      return {
        ok: false,
        error: `Missing action for pause option "${opt.label}"`,
      };
    }

    options.push({
      id: optionId,
      label: opt.label,
      value: opt.value,
      style: opt.style,
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

/* ── Countdown helper ── */

function formatCountdown(ms: number): string {
  if (ms <= 0) return "expired";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/* ── View ── */

function PauseCardView({
  state,
  data,
  invokeAction,
}: PluginViewProps<PauseCardData>) {
  const [now, setNow] = useState(() => Date.now());
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [localSubmittedId, setLocalSubmittedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedOption = data.options.find(
    (o) =>
      o.id === localSubmittedId ||
      (data.selectedValue && o.value === data.selectedValue) ||
      (data.selectedLabel && o.label === data.selectedLabel),
  );
  const expired = !!data.expiresAt && data.expiresAt <= now;
  const isLocked =
    expired || state === "tombstone" || (!!selectedOption && !error);

  useEffect(() => {
    if (!data.expiresAt || expired || state === "tombstone" || !!selectedOption)
      return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data.expiresAt, expired, selectedOption?.id, state]);

  useEffect(() => {
    if (data.selectedValue || data.selectedLabel || state === "settled") {
      setError(null);
      setSubmittingId(null);
    }
  }, [data.selectedLabel, data.selectedValue, state]);

  const countdown = useMemo(() => {
    if (!data.expiresAt) return null;
    return formatCountdown(data.expiresAt - now);
  }, [data.expiresAt, now]);

  const primary = data.options.find(
    (o) => o.style === "primary" || (!o.style && data.options.indexOf(o) === 0),
  );
  const rest = data.options.filter((o) => o !== primary);

  const handleSelect = async (option: PauseCardOption) => {
    if (isLocked || !!submittingId) return;
    setSubmittingId(option.id);
    setError(null);
    try {
      await invokeAction(option.action, {
        selectedLabel: option.label,
        selectedValue: option.value,
      });
      setLocalSubmittedId(option.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to submit selection.",
      );
    } finally {
      setSubmittingId(null);
    }
  };

  /* ── Tombstone ── */
  if (state === "tombstone") {
    return (
      <div
        data-testid="pause-card"
        className="bg-card rounded-2xl p-5 opacity-60"
      >
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground">
          <span className="size-1.5 rounded-full bg-foreground/20" />
          <span>Decision</span>
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize bg-secondary text-muted-foreground">
            expired
          </span>
        </div>
        <div className="mt-3 text-[13px] leading-relaxed text-foreground/60">
          {data.prompt}
        </div>
      </div>
    );
  }

  /* ── Resolved ── */
  if (isLocked && selectedOption) {
    return (
      <div
        data-testid="pause-card"
        className="bg-card rounded-2xl p-5 shadow-[0_4px_12px_rgba(0,0,0,0.04)] opacity-80"
      >
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground">
          <span className="size-1.5 rounded-full bg-brand-success-bg" />
          <span className="flex-1">Decision</span>
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize bg-brand-success-bg/30 text-brand-success-text">
            resolved
          </span>
        </div>
        <div className="mt-3 text-[13px] leading-relaxed text-foreground/70">
          {data.prompt}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          Selected:{" "}
          <span className="font-medium text-foreground/70">
            {selectedOption.label}
          </span>
        </div>
      </div>
    );
  }

  /* ── Expired ── */
  if (expired) {
    return (
      <div
        data-testid="pause-card"
        className="bg-card rounded-2xl p-5 shadow-[0_4px_12px_rgba(0,0,0,0.04)] opacity-75"
      >
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground">
          <span className="size-1.5 rounded-full bg-brand-failure" />
          <span className="flex-1">Decision</span>
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize bg-brand-failure/30 text-foreground/80">
            expired
          </span>
        </div>
        <div className="mt-3 text-[13px] leading-relaxed text-foreground/70">
          {data.prompt}
        </div>
      </div>
    );
  }

  /* ── Active / Pending ── */
  return (
    <div
      data-testid="pause-card"
      className="bg-card rounded-2xl p-5 shadow-[0_4px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300"
    >
      <div className="flex items-center gap-2 mb-3 text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground">
        {state === "active" ? (
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
          </span>
        ) : (
          <span className="size-1.5 rounded-full bg-foreground/30" />
        )}
        <span className="flex-1">Decision</span>
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize bg-amber-100 text-amber-800">
          waiting
        </span>
        {countdown && (
          <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
            {countdown}
          </span>
        )}
      </div>

      <div className="text-[13px] leading-relaxed text-foreground mb-4">
        {data.prompt}
      </div>

      {error && (
        <div className="mb-3 text-[11px] text-destructive">{error}</div>
      )}

      <div className="flex flex-col gap-2">
        {primary && (
          <button
            type="button"
            disabled={!!submittingId}
            onClick={() => handleSelect(primary)}
            className="w-full rounded-full border border-border bg-background py-2.5 px-4 text-[11px] font-medium text-foreground transition-colors duration-200 hover:bg-accent hover:text-accent-foreground disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submittingId === primary.id && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                className="animate-spin"
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
            )}
            {primary.label}
          </button>
        )}
        {rest.length > 0 && (
          <div className="flex gap-2">
            {rest.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={!!submittingId}
                onClick={() => handleSelect(opt)}
                className={`flex-1 rounded-full py-2 px-4 text-[11px] font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                  opt.style === "destructive"
                    ? "text-destructive hover:text-destructive/80"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {submittingId === opt.id && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    className="animate-spin"
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
                )}
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Plugin definition ── */

export const pauseCardPlugin: MobileClawPlugin<PauseCardData> = {
  type: "pause_card",
  width: "chat",
  parse: (raw) => {
    const parsed = pauseCardSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message || "Invalid plugin payload",
      };
    }
    return normalizePauseCardData(parsed.data);
  },
  render: (props) => <PauseCardView {...props} />,
};
