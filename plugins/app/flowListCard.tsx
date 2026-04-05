"use client";

import { z } from "zod";
import type { MobileClawPlugin, PluginViewProps } from "@mc/lib/plugins/types";

// ── Schema ──────────────────────────────────────────────────────────────────

const flowEntrySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  status: z.string().optional(),
  isPublished: z.boolean().optional(),
  triggerType: z.string().nullable().optional(),
  triggerPiece: z.string().nullable().optional(),
  updated: z.string().optional(),
  lastRun: z.object({
    status: z.string().optional(),
    createdAt: z.string().optional(),
  }).nullable().optional(),
});

const flowListCardSchema = z.object({
  flows: z.array(flowEntrySchema),
  total: z.number().optional(),
});

type FlowListCardData = z.infer<typeof flowListCardSchema>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusDotClass(status?: string): string {
  if (status === "ENABLED") return "bg-emerald-500";
  if (status === "DISABLED") return "bg-muted-foreground/40";
  return "bg-muted-foreground/40";
}

function friendlyTrigger(triggerType?: string | null, triggerPiece?: string | null): string | null {
  if (!triggerType && !triggerPiece) return null;
  if (triggerPiece) {
    // Extract short name: "@activepieces/piece-gmail" → "gmail"
    const match = triggerPiece.match(/piece-(.+)$/);
    return match ? match[1] : triggerPiece;
  }
  if (triggerType === "WEBHOOK") return "webhook";
  if (triggerType === "SCHEDULE") return "schedule";
  return triggerType?.toLowerCase() ?? null;
}

function lastRunBadgeClass(status?: string): string {
  switch (status) {
    case "SUCCEEDED":
      return "text-emerald-600 dark:text-emerald-400";
    case "FAILED":
    case "INTERNAL_ERROR":
    case "TIMEOUT":
      return "text-destructive";
    case "RUNNING":
      return "text-primary";
    default:
      return "text-muted-foreground";
  }
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── View ────────────────────────────────────────────────────────────────────

function FlowListCardView({ state, data }: PluginViewProps<FlowListCardData>) {
  if (state === "tombstone") {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3">
        <div className="text-sm text-muted-foreground">Flow list no longer available</div>
      </div>
    );
  }

  const { flows, total } = data;
  const hasMore = total && total > flows.length;

  return (
    <div className="rounded-2xl border border-border bg-card/80 overflow-hidden">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-border/60">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0">
            <path d="M16 3h5v5" /><path d="M8 3H3v5" />
            <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
            <path d="m15 9 6-6" />
          </svg>
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Flows{total ? ` (${total})` : ""}
          </span>
        </div>
      </div>

      {/* List */}
      <div className="max-h-[280px] overflow-y-auto">
        {flows.map((flow, i) => {
          const trigger = friendlyTrigger(flow.triggerType, flow.triggerPiece);
          return (
            <div
              key={flow.id}
              className={`px-3.5 py-2.5 flex items-center gap-3 ${
                i < flows.length - 1 ? "border-b border-border/40" : ""
              }`}
            >
              <div className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(flow.status)}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate">{flow.displayName}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  {trigger && (
                    <span className="text-[10px] text-muted-foreground">{trigger}</span>
                  )}
                  {flow.lastRun?.status && (
                    <span className={`text-[10px] ${lastRunBadgeClass(flow.lastRun.status)}`}>
                      {flow.lastRun.status.toLowerCase()}
                      {flow.lastRun.createdAt && ` ${timeAgo(flow.lastRun.createdAt)}`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {hasMore && (
        <div className="px-3.5 py-2 border-t border-border/60">
          <span className="text-[10px] text-muted-foreground">
            +{total! - flows.length} more
          </span>
        </div>
      )}
    </div>
  );
}

// ── Plugin definition ───────────────────────────────────────────────────

export const flowListCardPlugin: MobileClawPlugin<FlowListCardData> = {
  type: "flow_list_card",
  width: "chat",
  parse: (raw) => {
    const parsed = flowListCardSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message || "Invalid flow list card payload" };
    }
    return { ok: true, value: parsed.data };
  },
  render: (props) => <FlowListCardView {...props} />,
};
