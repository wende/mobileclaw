"use client";

import { z } from "zod";

import type {
  MobileClawPlugin,
  PluginViewProps,
} from "@mc/lib/plugins/types";

/* ── Zod schema ── */

const connectionItemSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  displayName: z.string(),
  pieceName: z.string(),
  status: z.string(),
});

const connectionListCardSchema = z.object({
  connections: z.array(connectionItemSchema),
  total: z.number().optional(),
});

type ConnectionListCardData = z.infer<typeof connectionListCardSchema>;

/* ── Helpers ── */

export function formatPieceName(pieceName: string): string {
  return pieceName
    .replace("@activepieces/piece-", "")
    .replace(/^@[^/]+\//, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusDotClass(status: string): string {
  if (status === "ACTIVE") return "bg-brand-success-bg";
  if (status === "ERROR" || status === "EXPIRED") return "bg-brand-failure";
  return "bg-muted-foreground/40";
}

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE") return "bg-brand-success-bg/30 text-brand-success-text";
  if (status === "ERROR" || status === "EXPIRED") return "bg-brand-failure/20 text-brand-failure";
  return "bg-secondary text-muted-foreground";
}

/* ── Shared inner component ── */

export interface ConnectionListCardInnerProps {
  connections: Array<{
    id: string;
    externalId: string;
    displayName: string;
    pieceName: string;
    status: string;
  }>;
  total?: number;
  onConnectionClick?: (connection: {
    id: string;
    externalId: string;
    displayName: string;
  }) => void;
}

export function ConnectionListCardInner({
  connections,
  total,
  onConnectionClick,
}: ConnectionListCardInnerProps) {
  const count = total ?? connections.length;

  return (
    <div className="overflow-hidden rounded-[24px] bg-card border border-border/50 shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
          Connections
        </span>
        <span className="text-[11px] text-muted-foreground/60">
          {count} connection{count !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Connection items */}
      <div className="divide-y divide-border/40">
        {connections.map((conn) => (
          <div
            key={conn.id}
            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/30 cursor-pointer"
            onClick={() =>
              onConnectionClick?.({
                id: conn.id,
                externalId: conn.externalId,
                displayName: conn.displayName,
              })
            }
          >
            {/* Status dot */}
            <span
              className={`size-2 rounded-full shrink-0 ${statusDotClass(conn.status)}`}
            />

            {/* Name + piece */}
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-medium text-foreground truncate block">
                {conn.displayName}
              </span>
              <span className="text-[11px] text-muted-foreground truncate block">
                {formatPieceName(conn.pieceName)}
              </span>
            </div>

            {/* Status badge */}
            <span
              className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-[0.08em] uppercase ${statusBadgeClass(conn.status)}`}
            >
              {conn.status}
            </span>
          </div>
        ))}
      </div>

      {/* Show more indicator */}
      {total != null && total > connections.length && (
        <div className="px-5 py-2.5 text-center text-[11px] text-muted-foreground/60 border-t border-border/40">
          +{total - connections.length} more
        </div>
      )}
    </div>
  );
}

/* ── Plugin view ── */

function ConnectionListCardView({
  state,
  data,
  addInputAttachment,
}: PluginViewProps<ConnectionListCardData>) {
  if (state === "tombstone") {
    return (
      <div
        data-testid="connection-list-card"
        className="rounded-2xl border border-dashed border-border bg-card/50 px-3.5 py-3"
      >
        <div className="text-sm text-muted-foreground">
          Connection list no longer available.
        </div>
      </div>
    );
  }

  const handleClick = (connection: {
    id: string;
    externalId: string;
    displayName: string;
  }) => {
    addInputAttachment?.("connection", connection);
  };

  return (
    <div data-testid="connection-list-card">
      <ConnectionListCardInner
        connections={data.connections}
        total={data.total}
        onConnectionClick={handleClick}
      />
    </div>
  );
}

/* ── Plugin definition ── */

export const connectionListCardPlugin: MobileClawPlugin<ConnectionListCardData> = {
  type: "connection_list_card",
  width: "chat",
  parse: (raw) => {
    const parsed = connectionListCardSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          parsed.error.issues[0]?.message || "Invalid connection list payload",
      };
    }
    return { ok: true, value: parsed.data };
  },
  render: (props) => <ConnectionListCardView {...props} />,
};
