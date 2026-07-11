"use client";

import type { InputAttachmentPlugin } from "@mc/lib/plugins/inputAttachmentTypes";

interface FlowRunData {
  id: string;
  displayName: string;
  status: string;
}

function statusDotColor(status: string): string {
  switch (status) {
    case "RUNNING":
    case "QUEUED":
      return "var(--brand-ongoing)";
    case "SUCCEEDED":
      return "var(--brand-success)";
    case "FAILED":
    case "INTERNAL_ERROR":
    case "TIMEOUT":
    case "QUOTA_EXCEEDED":
    case "MEMORY_LIMIT_EXCEEDED":
    case "LOG_SIZE_EXCEEDED":
    case "CANCELED":
      return "var(--brand-failure)";
    case "PAUSED":
    case "SCHEDULED":
      return "var(--brand-paused)";
    default:
      return "var(--muted-foreground)";
  }
}

export const flowRunAttachmentPlugin: InputAttachmentPlugin<FlowRunData> = {
  kind: "flow_run",
  renderPreview: ({ data, onRemove }) => (
    <div className="relative shrink-0 h-10 flex items-center gap-1.5 rounded-lg border border-border bg-card/80 px-2.5">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: statusDotColor(data.status) }}
      />
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
        <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
      </svg>
      <span className="max-w-[140px] truncate text-xs font-medium text-foreground">{data.displayName}</span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  ),
  toSendContribution: (data) => ({
    textPrefix: `[flow: ${data.id}]`,
  }),
};
