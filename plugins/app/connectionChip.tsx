"use client";

import type { InputAttachmentPlugin } from "@mc/lib/plugins/inputAttachmentTypes";

interface ConnectionData {
  id: string;
  externalId: string;
  displayName: string;
}

export const connectionAttachmentPlugin: InputAttachmentPlugin<ConnectionData> = {
  kind: "connection",
  renderPreview: ({ data, onRemove }) => (
    <div className="relative shrink-0 h-10 flex items-center gap-1.5 rounded-lg border border-border bg-card/80 px-2.5">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-muted-foreground"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      <span className="max-w-[140px] truncate text-xs font-medium text-foreground">
        {data.displayName}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  ),
  toSendContribution: (data) => ({
    textPrefix: `[connection: ${data.externalId}]`,
  }),
};
