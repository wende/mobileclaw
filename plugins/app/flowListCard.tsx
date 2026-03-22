"use client";

import { z } from "zod";

import type {
  MobileClawPlugin,
  PluginViewProps,
} from "@mc/lib/plugins/types";

/* ── Zod schema ── */

const flowItemSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  status: z.string().optional(),
  isPublished: z.boolean().optional(),
  triggerType: z.string().nullable().optional(),
  triggerPiece: z.string().nullable().optional(),
  updated: z.string().optional(),
  lastRun: z
    .object({
      status: z.string(),
      createdAt: z.string(),
    })
    .nullable()
    .optional(),
});

const flowListCardSchema = z.object({
  flows: z.array(flowItemSchema),
  total: z.number().optional(),
});

type FlowListCardData = z.infer<typeof flowListCardSchema>;

/* ── Shared helpers ── */

export function resolvePublishedState(flow: {
  isPublished?: boolean;
}): "draft" | "published" {
  return flow.isPublished ? "published" : "draft";
}

export function publishedLabel(state: "draft" | "published"): string {
  return state === "published" ? "Live" : "Draft";
}

export function resolveTriggerLabel(flow: {
  triggerPiece?: string | null;
  triggerType?: string | null;
}): string {
  if (!flow.triggerPiece && !flow.triggerType) return "Unknown";
  if (flow.triggerPiece === "@activepieces/piece-manual-trigger") return "Manual";
  if (flow.triggerPiece === "@activepieces/piece-webhook") return "Webhook";
  if (flow.triggerPiece) {
    return flow.triggerPiece
      .replace("@activepieces/piece-", "")
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  if (flow.triggerType) {
    return flow.triggerType
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return "Unknown";
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTimeFromISO(isoDate: string | undefined): string {
  if (!isoDate) return "";
  const diffMs = new Date(isoDate).getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  if (absMs < 60_000)
    return rtf.format(Math.round(diffMs / 1_000), "second");
  if (absMs < 3_600_000)
    return rtf.format(Math.round(diffMs / 60_000), "minute");
  if (absMs < 86_400_000)
    return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  return rtf.format(Math.round(diffMs / 86_400_000), "day");
}

function LastRunIcon({ status }: { status: string }) {
  if (status === "SUCCEEDED")
    return (
      <svg
        width="10"
        height="10"
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
        width="10"
        height="10"
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
  if (
    status === "FAILED" ||
    status === "INTERNAL_ERROR" ||
    status === "TIMEOUT"
  )
    return (
      <svg
        width="10"
        height="10"
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
        width="10"
        height="10"
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

export interface FlowListCardInnerProps {
  flows: Array<{
    id: string;
    displayName?: string;
    status?: string;
    isPublished?: boolean;
    triggerPiece?: string | null;
    triggerType?: string | null;
    updated?: string;
    lastRun?: { status: string; createdAt: string } | null;
  }>;
  total?: number;
  onFlowClick?: (flowId: string) => void;
}

export function FlowListCardInner({
  flows,
  total,
  onFlowClick,
}: FlowListCardInnerProps) {
  const count = total ?? flows.length;

  return (
    <div className="overflow-hidden rounded-[24px] bg-card border border-border/50 shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
          Workflows
        </span>
        <span className="text-[11px] text-muted-foreground/60">
          {count} flow{count !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Flow items */}
      <div className="divide-y divide-border/40">
        {flows.map((flow) => {
          const pubState = resolvePublishedState(flow);
          const isEnabled = flow.status === "ENABLED";
          const trigger = resolveTriggerLabel(flow);
          const lastRunTime = flow.lastRun?.createdAt
            ? relativeTimeFromISO(flow.lastRun.createdAt)
            : null;

          return (
            <div
              key={flow.id}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/30 cursor-pointer"
              onClick={() => onFlowClick?.(flow.id)}
            >
              {/* Published dot */}
              <span
                className={`size-2 rounded-full shrink-0 ${
                  pubState === "published" && isEnabled
                    ? "bg-foreground"
                    : pubState === "published"
                      ? "bg-foreground/40"
                      : "border border-muted-foreground/40"
                }`}
              />

              {/* Name + details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground truncate">
                    {flow.displayName?.trim() || "Untitled workflow"}
                  </span>
                  <span
                    className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-[0.08em] uppercase ${
                      pubState === "published"
                        ? "bg-foreground text-background"
                        : "border border-border text-muted-foreground"
                    }`}
                  >
                    {publishedLabel(pubState)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                  <span>{trigger}</span>
                  {lastRunTime && flow.lastRun ? (
                    <>
                      <span>&middot;</span>
                      <span className="inline-flex items-center gap-1">
                        <LastRunIcon status={flow.lastRun.status} />
                        {lastRunTime}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>&middot;</span>
                      <span className="text-muted-foreground/50">
                        Never run
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Enabled indicator */}
              <div
                className={`size-6 rounded-full flex items-center justify-center shrink-0 ${
                  isEnabled ? "bg-foreground" : "bg-muted-foreground/10"
                }`}
              >
                {isEnabled ? (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-background"
                  >
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                ) : (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="text-muted-foreground/40"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Show more indicator */}
      {total != null && total > flows.length && (
        <div className="px-5 py-2.5 text-center text-[11px] text-muted-foreground/60 border-t border-border/40">
          +{total - flows.length} more
        </div>
      )}
    </div>
  );
}

/* ── Plugin view ── */

function FlowListCardView({
  state,
  data,
  addInputAttachment,
}: PluginViewProps<FlowListCardData>) {
  if (state === "tombstone") {
    return (
      <div
        data-testid="flow-list-card"
        className="rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3"
      >
        <div className="text-sm text-muted-foreground">
          Flow list no longer available.
        </div>
      </div>
    );
  }

  const handleFlowClick = (flowId: string) => {
    const flow = data.flows.find((f) => f.id === flowId);
    addInputAttachment?.("flow", {
      id: flowId,
      displayName: flow?.displayName?.trim() || "Untitled",
      status: flow?.status ?? "UNKNOWN",
    });
  };

  return (
    <div data-testid="flow-list-card">
      <FlowListCardInner
        flows={data.flows}
        total={data.total}
        onFlowClick={handleFlowClick}
      />
    </div>
  );
}

/* ── Plugin definition ── */

export const flowListCardPlugin: MobileClawPlugin<FlowListCardData> = {
  type: "flow_list_card",
  width: "chat",
  parse: (raw) => {
    const parsed = flowListCardSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message || "Invalid flow list payload",
      };
    }
    return { ok: true, value: parsed.data };
  },
  render: (props) => <FlowListCardView {...props} />,
};
