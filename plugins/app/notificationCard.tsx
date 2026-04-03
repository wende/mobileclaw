"use client";

import { type ReactNode, useEffect, useState } from "react";

import { z } from "zod";

import type { PluginAction } from "@mc/types/chat";
import type {
  MobileClawPlugin,
  PluginParseResult,
  PluginViewProps,
} from "@mc/lib/plugins/types";
import { InlineMarkdown } from "@mc/components/markdown/MarkdownContent";

/* ── Zod schema ── */

const optionSchema = z.object({
  label: z.string(),
  value: z.string(),
  style: z.enum(["primary", "secondary", "destructive"]).optional(),
});

const notificationCardSchema = z.object({
  notificationId: z.string(),
  flowName: z.string().optional(),
  question: z.string(),
  context: z.string().optional(),
  target: z.enum(["agent", "user"]),
  urgency: z.enum(["high", "low"]),
  mode: z.enum(["blocking", "notify"]).optional(),
  createdAt: z.number(),
  options: z.array(optionSchema),
  resolvedLabel: z.string().optional(),
  resolvedValue: z.string().optional(),
});

type NotificationCardInput = z.infer<typeof notificationCardSchema>;

/* ── Parsed data with actions ── */

type NotificationCardOption = {
  id: string;
  label: string;
  value: string;
  style?: "primary" | "secondary" | "destructive";
  action: PluginAction;
};

type NotificationCardData = {
  notificationId: string;
  flowName?: string;
  question: string;
  context?: string;
  target: "agent" | "user";
  urgency: "high" | "low";
  mode?: "blocking" | "notify";
  createdAt: number;
  options: NotificationCardOption[];
  dismissAction: PluginAction;
  resolvedLabel?: string;
  resolvedValue?: string;
};

/* ── Parse: normalize options into actions ── */

function normalizeNotificationData(
  raw: NotificationCardInput,
): PluginParseResult<NotificationCardData> {
  const baseUrl = `/api/notifications/${raw.notificationId}`;

  const options: NotificationCardOption[] = raw.options.map((opt, i) => ({
    id: `option-${i}`,
    label: opt.label,
    value: opt.value,
    style: opt.style,
    action: {
      id: `resolve-${i}`,
      label: opt.label,
      style: opt.style,
      request: {
        kind: "http" as const,
        method: "POST" as const,
        url: `${baseUrl}/resolve`,
        body: { label: opt.label, value: opt.value },
      },
    },
  }));

  const dismissAction: PluginAction = {
    id: "dismiss",
    label: "Dismiss",
    request: {
      kind: "http" as const,
      method: "POST" as const,
      url: `${baseUrl}/dismiss`,
      fireAndForget: true,
    },
  };

  return {
    ok: true,
    value: {
      notificationId: raw.notificationId,
      flowName: raw.flowName,
      question: raw.question,
      context: raw.context,
      target: raw.target,
      urgency: raw.urgency,
      mode: raw.mode,
      createdAt: raw.createdAt,
      options,
      dismissAction,
      resolvedLabel: raw.resolvedLabel,
      resolvedValue: raw.resolvedValue,
    },
  };
}

/* ── Relative time helper ── */

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTimeFromEpoch(ts: number): string {
  const diffMs = ts - Date.now();
  const absMs = Math.abs(diffMs);
  if (absMs < 60_000) return rtf.format(Math.round(diffMs / 1_000), "second");
  if (absMs < 3_600_000)
    return rtf.format(Math.round(diffMs / 60_000), "minute");
  if (absMs < 86_400_000)
    return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  return rtf.format(Math.round(diffMs / 86_400_000), "day");
}

function useRelativeTime(ts: number): string {
  const [, tick] = useState(0);
  useEffect(() => {
    const absMs = Math.abs(ts - Date.now());
    const ms =
      absMs < 60_000 ? 1_000 : absMs < 3_600_000 ? 30_000 : 60_000;
    const id = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ts]);
  return relativeTimeFromEpoch(ts);
}

/* ── Shared inner component ── */

export interface NotificationCardInnerProps {
  flowName?: string;
  question: string;
  context?: string;
  urgency: "high" | "low";
  mode?: "blocking" | "notify";
  createdAt: number;
  options: Array<{
    label: string;
    value: string;
    style?: "primary" | "secondary" | "destructive";
  }>;
  resolving?: boolean;
  resolved?: boolean;
  resolvedLabel?: string;
  status?: string;
  onResolve?: (label: string, value: string) => void;
  renderMarkdown?: (text: string) => ReactNode;
}

export function NotificationCardInner({
  flowName,
  question,
  context,
  urgency,
  mode,
  createdAt,
  options,
  resolving,
  resolved,
  resolvedLabel,
  status,
  onResolve,
  renderMarkdown,
}: NotificationCardInnerProps) {
  const [expanded, setExpanded] = useState(false);
  const timeAgo = useRelativeTime(createdAt);
  const isHigh = urgency === "high";
  const isNotify = mode === "notify" || options.length === 0;
  const primary = isNotify
    ? null
    : options.find((o) => o.style === "primary" || !o.style);
  const rest = isNotify ? [] : options.filter((o) => o !== primary);

  const md = (text: string) =>
    renderMarkdown ? renderMarkdown(text) : <InlineMarkdown text={text} />;

  if (resolved) {
    return (
      <div className="bg-card rounded-2xl p-6 shadow-[0_4px_12px_rgba(0,0,0,0.04)] opacity-75">
        <div className="flex items-center gap-2 mb-3 text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-foreground/20" />
          <span className="flex-1">
            {flowName?.trim() || "Workflow"}
          </span>
          {status && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                status === "resolved"
                  ? "bg-brand-success-bg/30 text-brand-success-text"
                  : status === "rejected"
                    ? "bg-brand-failure/30 text-foreground/80"
                    : status === "expired"
                      ? "bg-zinc-100 text-zinc-500"
                      : "bg-secondary text-muted-foreground"
              }`}
            >
              {status}
            </span>
          )}
          <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
            {timeAgo}
          </span>
        </div>

        <div
          className="relative cursor-pointer"
          onClick={() => setExpanded((v) => !v)}
        >
          <div
            className={`text-[13px] leading-relaxed text-foreground/70 break-words overflow-hidden ${expanded ? "" : "max-h-[9em]"}`}
          >
            {md(question)}
          </div>

          {expanded && context && (
            <div className="text-[13px] text-muted-foreground mt-1 break-words overflow-hidden">
              {md(context)}
            </div>
          )}

          {!expanded && (
            <div className="absolute bottom-0 left-0 right-0 h-5 bg-gradient-to-t from-card to-transparent pointer-events-none" />
          )}
        </div>

        {resolvedLabel && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Resolved:{" "}
            <span className="font-medium text-foreground/70">
              {resolvedLabel}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl p-6 shadow-[0_4px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300">
      <div className="flex items-center gap-2 mb-3 text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground">
        <span
          className={`w-1.5 h-1.5 rounded-full ${isHigh ? "bg-foreground" : "bg-foreground/30"}`}
        />
        <span className="flex-1">
          {flowName?.trim() || "Workflow"}
        </span>
        {!isNotify && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize bg-amber-100 text-amber-800">
            pending
          </span>
        )}
        <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
          {timeAgo}
        </span>
      </div>

      <div
        className="relative cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div
          className={`text-[13px] leading-relaxed text-foreground break-words overflow-hidden ${expanded ? "" : "max-h-[9em]"}`}
        >
          {md(question)}
        </div>

        {context && (
          <div
            className={`text-[13px] text-muted-foreground break-words overflow-hidden ${expanded ? "mt-1" : "max-h-[9em] mt-0.5"}`}
          >
            {md(context)}
          </div>
        )}

        {!expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-5 bg-gradient-to-t from-card to-transparent pointer-events-none" />
        )}
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors mb-3 mt-1"
      >
        {expanded ? "Show less" : "Show more"}
      </button>

      <div className="flex flex-col gap-2">
        {isNotify ? (
          <button
            disabled={resolving}
            onClick={() => onResolve?.("dismissed", "dismissed")}
            className="w-full rounded-full border border-border bg-background py-2.5 px-4 text-[11px] font-medium text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-accent-foreground disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {resolving && (
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
            Dismiss
          </button>
        ) : (
          <>
            {primary && (
              <button
                disabled={resolving}
                onClick={() => onResolve?.(primary.label, primary.value)}
                className="w-full rounded-full border border-border bg-background py-2.5 px-4 text-[11px] font-medium text-foreground transition-colors duration-200 hover:bg-accent hover:text-accent-foreground disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {resolving && (
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
                    key={opt.value}
                    disabled={resolving}
                    onClick={() => onResolve?.(opt.label, opt.value)}
                    className={`flex-1 rounded-full py-2 px-4 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                      opt.style === "destructive"
                        ? "text-destructive hover:text-destructive/80"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  disabled={resolving}
                  onClick={() => onResolve?.("dismissed", "dismissed")}
                  className="flex-1 rounded-full py-2 px-4 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Plugin view (wraps inner with plugin infrastructure) ── */

function NotificationCardView({
  state,
  data,
  invokeAction,
}: PluginViewProps<NotificationCardData>) {
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isResolved = state === "settled" || !!data.resolvedLabel;

  const handleResolve = async (label: string, value: string) => {
    const isDismiss = label === "dismissed" && value === "dismissed";
    const action = isDismiss
      ? data.dismissAction
      : data.options.find((o) => o.label === label && o.value === value)
          ?.action;
    if (!action) return;

    setResolving(true);
    setError(null);
    try {
      await invokeAction(action, {
        selectedLabel: label,
        selectedValue: value,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to submit selection.",
      );
    } finally {
      setResolving(false);
    }
  };

  if (state === "tombstone") {
    return (
      <div
        data-testid="notification-card"
        className="rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3"
      >
        <div className="text-sm text-muted-foreground">
          Notification expired.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="notification-card">
      {error && (
        <div className="mb-2 text-xs text-destructive">{error}</div>
      )}
      <NotificationCardInner
        flowName={data.flowName}
        question={data.question}
        context={data.context}
        urgency={data.urgency}
        mode={data.mode}
        createdAt={data.createdAt}
        options={data.options}
        resolving={resolving}
        resolved={isResolved}
        resolvedLabel={data.resolvedLabel}
        onResolve={handleResolve}
      />
    </div>
  );
}

/* ── Plugin definition ── */

export const notificationCardPlugin: MobileClawPlugin<NotificationCardData> = {
  type: "notification_card",
  width: "chat",
  parse: (raw) => {
    const parsed = notificationCardSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message || "Invalid notification payload",
      };
    }
    return normalizeNotificationData(parsed.data);
  },
  render: (props) => <NotificationCardView {...props} />,
};
