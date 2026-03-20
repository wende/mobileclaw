"use client";

import { useState } from "react";
import type { MobileClawPlugin, PluginViewProps } from "@/lib/plugins/types";
import type { InputAttachmentPlugin } from "@/lib/plugins/inputAttachmentTypes";

// ── Message plugin: renders a button in the chat thread ──────────────────────

interface ContextChipData {
  label: string;
  context: string;
  description?: string;
}

function ContextChipView({ data, state, addInputAttachment }: PluginViewProps<ContextChipData>) {
  const [added, setAdded] = useState(false);

  const handleClick = () => {
    if (!addInputAttachment || added) return;
    addInputAttachment("prompt_context", { label: data.label, context: data.context });
    setAdded(true);
  };

  const isTombstone = state === "tombstone";

  return (
    <div data-testid="context-chip" className={`rounded-2xl border ${isTombstone ? "border-dashed border-border bg-card/50" : "border-border bg-card/80"} px-3.5 py-3`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-5 w-5 shrink-0 items-center justify-center ${added ? "text-primary" : "text-muted-foreground"}`}>
          {added ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{data.label}</div>
          {data.description && (
            <div className="mt-0.5 text-xs text-muted-foreground">{data.description}</div>
          )}
        </div>
        {!isTombstone && (
          <button
            type="button"
            onClick={handleClick}
            disabled={added}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              added
                ? "bg-primary/10 text-primary cursor-default"
                : "bg-secondary hover:bg-accent text-foreground"
            }`}
          >
            {added ? "Added" : "Attach"}
          </button>
        )}
      </div>
    </div>
  );
}

export const contextChipPlugin: MobileClawPlugin<ContextChipData> = {
  type: "context_chip",
  width: "chat",
  parse: (raw) => {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "Expected object" };
    const r = raw as Record<string, unknown>;
    if (typeof r.label !== "string" || typeof r.context !== "string") {
      return { ok: false, error: "Missing label or context" };
    }
    return {
      ok: true,
      value: {
        label: r.label,
        context: r.context,
        description: typeof r.description === "string" ? r.description : undefined,
      },
    };
  },
  render: (props) => <ContextChipView {...props} />,
};

// ── Input attachment plugin: renders a chip in the compose strip ─────────────

interface PromptContextData {
  label: string;
  context: string;
}

export const promptContextAttachmentPlugin: InputAttachmentPlugin<PromptContextData> = {
  kind: "prompt_context",
  renderPreview: ({ data, onRemove }) => (
    <div className="relative shrink-0 h-10 flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-primary/70">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="M10 12h4" /><path d="M10 16h4" />
      </svg>
      <span className="max-w-[140px] truncate text-xs font-medium text-primary/90">{data.label}</span>
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
    textPrefix: `> [context: ${data.label}]\n` + data.context.split("\n").map((l: string) => `> ${l}`).join("\n"),
  }),
};
