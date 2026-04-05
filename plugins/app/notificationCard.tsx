"use client";

import { useState } from "react";
import { z } from "zod";
import type { MobileClawPlugin, PluginViewProps } from "@mc/lib/plugins/types";
import type { PluginAction, PluginActionStyle } from "@mc/types/chat";

// ── Schema ──────────────────────────────────────────────────────────────────

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
  urgency: z.enum(["high", "low"]).default("low"),
  mode: z.enum(["blocking", "notify"]).optional(),
  createdAt: z.number().optional(),
  options: z.array(optionSchema).default([]),
  resolvedLabel: z.string().optional(),
});

type NotificationCardData = z.infer<typeof notificationCardSchema>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function optionToneClass(style: PluginActionStyle | undefined) {
  if (style === "primary") return "text-primary";
  if (style === "destructive") return "text-destructive";
  return "text-muted-foreground";
}

// ── NotificationCardInner (standalone export for 8claw sidebar) ─────────

export interface NotificationCardInnerProps {
  flowName?: string;
  question: string;
  context?: string;
  urgency: "high" | "low";
  mode?: "blocking" | "notify";
  createdAt?: number;
  options: Array<{ label: string; value: string; style?: "primary" | "secondary" | "destructive" }>;
  resolving?: boolean;
  onResolve?: (label: string, value: string) => void;
  renderMarkdown?: (text: string) => React.ReactNode;
  // For settled state
  resolved?: boolean;
  resolvedLabel?: string;
  status?: string;
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
  onResolve,
  renderMarkdown,
  resolved,
  resolvedLabel,
  status,
}: NotificationCardInnerProps) {
  const isBlocking = mode === "blocking";
  const isHighUrgency = urgency === "high";
  const isSettled = resolved || status === "resolved" || status === "rejected" || status === "expired";

  const borderClass = isSettled
    ? "border-dashed border-border"
    : isHighUrgency
      ? "border-destructive/30"
      : "border-border";

  return (
    <div className={`rounded-2xl border ${borderClass} bg-card/80 px-3.5 py-3`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center ${
          isSettled ? "text-muted-foreground" : isHighUrgency ? "text-destructive" : "text-primary"
        }`}>
          {isSettled ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          ) : isHighUrgency ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" /><path d="M12 17h.01" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {flowName && (
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {flowName}
              </span>
            )}
            {createdAt && (
              <span className="text-[10px] text-muted-foreground/60">
                {timeAgo(createdAt)}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm leading-6 text-foreground">
            {renderMarkdown ? renderMarkdown(question) : question}
          </div>
          {context && (
            <div className="mt-1.5 text-xs leading-5 text-muted-foreground">
              {renderMarkdown ? renderMarkdown(context) : context}
            </div>
          )}
        </div>
      </div>

      {/* Settled indicator */}
      {isSettled && resolvedLabel && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
            {resolvedLabel}
          </span>
        </div>
      )}

      {isSettled && status === "rejected" && (
        <div className="mt-2 text-xs text-destructive/80">Rejected</div>
      )}

      {isSettled && status === "expired" && (
        <div className="mt-2 text-xs text-muted-foreground/60">Expired</div>
      )}

      {/* Action buttons (only when pending) */}
      {!isSettled && options.length > 0 && isBlocking && (
        <div className="mt-3 -mx-3.5 border-t border-border/80">
          {options.map((option, i) => (
            <button
              key={`${option.value}-${i}`}
              type="button"
              disabled={resolving}
              onClick={() => onResolve?.(option.label, option.value)}
              className={[
                "group w-full border-t border-border/70 px-3.5 py-2.5 text-left text-sm font-medium transition-colors first:border-t-0",
                resolving ? "cursor-not-allowed opacity-60" : "hover:bg-secondary/45",
              ].join(" ")}
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center ${optionToneClass(option.style)}`}>
                  {option.style === "destructive" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18" /><path d="M6 6l12 12" />
                    </svg>
                  ) : option.style === "primary" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="8" />
                    </svg>
                  )}
                </div>
                <span className="min-w-0 flex-1">{option.label}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Dismiss button for notify mode */}
      {!isSettled && mode === "notify" && (
        <div className="mt-3 -mx-3.5 border-t border-border/80">
          <button
            type="button"
            disabled={resolving}
            onClick={() => onResolve?.("dismissed", "dismissed")}
            className="w-full px-3.5 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/45 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="M6 6l12 12" />
                </svg>
              </div>
              <span>Dismiss</span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Plugin view (for chat stream rendering) ─────────────────────────────

function NotificationCardView({ state, data, invokeAction }: PluginViewProps<NotificationCardData>) {
  const [submittingLabel, setSubmittingLabel] = useState<string | null>(null);
  const [localResolvedLabel, setLocalResolvedLabel] = useState<string | null>(null);

  const resolvedLabel = data.resolvedLabel || localResolvedLabel;
  const isSettled = state === "settled" || state === "tombstone" || !!resolvedLabel;

  const handleResolve = async (label: string, value: string) => {
    setSubmittingLabel(label);
    try {
      const isDismiss = label === "dismissed" && value === "dismissed";
      const url = isDismiss
        ? `/api/notifications/${data.notificationId}/dismiss`
        : `/api/notifications/${data.notificationId}/resolve`;
      const action: PluginAction = {
        id: `resolve-${data.notificationId}`,
        label,
        request: {
          kind: "http",
          method: "POST",
          url,
          body: isDismiss ? undefined : { label, value },
        },
      };
      await invokeAction(action, { selectedLabel: label, selectedValue: value });
      setLocalResolvedLabel(label);
    } catch {
      // invokeAction handles error display
    } finally {
      setSubmittingLabel(null);
    }
  };

  if (state === "tombstone") {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3">
        <div className="text-sm text-muted-foreground">Notification dismissed</div>
      </div>
    );
  }

  return (
    <NotificationCardInner
      flowName={data.flowName}
      question={data.question}
      context={data.context}
      urgency={data.urgency}
      mode={data.mode}
      createdAt={data.createdAt}
      options={data.options}
      resolving={!!submittingLabel}
      onResolve={handleResolve}
      resolved={isSettled}
      resolvedLabel={resolvedLabel ?? undefined}
    />
  );
}

// ── Plugin definition ───────────────────────────────────────────────────

export const notificationCardPlugin: MobileClawPlugin<NotificationCardData> = {
  type: "notification_card",
  width: "chat",
  parse: (raw) => {
    const parsed = notificationCardSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message || "Invalid notification card payload" };
    }
    return { ok: true, value: parsed.data };
  },
  render: (props) => <NotificationCardView {...props} />,
};
