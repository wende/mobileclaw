"use client";

import { useCallback } from "react";
import { getToolDisplay } from "@/lib/toolDisplay";
import { SubagentActivityFeed } from "@/components/SubagentActivityFeed";
import type { SubagentStore } from "@/hooks/useSubagentStore";

interface ToolCallPillProps {
  name: string;
  args?: string;
  status?: "running" | "success" | "error";
  result?: string;
  resultError?: boolean;
  toolCallId?: string;
  subagentStore?: SubagentStore;
}

export function ToolCallPill({ name, args, status, result, resultError, toolCallId, subagentStore }: ToolCallPillProps) {
  const formatJson = (s: string) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };
  const display = getToolDisplay(name, args);

  const isSpawnWithFeed = name === "sessions_spawn" && subagentStore && toolCallId;

  const getEntries = useCallback(() => {
    if (!toolCallId || !subagentStore) return null;
    return subagentStore.getEntriesForToolCall(toolCallId);
  }, [toolCallId, subagentStore]);

  const iconCls = "inline-block mr-1.5 align-[-1px] shrink-0";
  const statusIcon = status === "running" ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${iconCls} animate-spin opacity-50`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  ) : resultError ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${iconCls} text-destructive`}>
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ) : null;

  const toolIcon = display.icon === "terminal" ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${iconCls} opacity-50`}>
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ) : display.icon === "file" ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${iconCls} opacity-50`}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  ) : display.icon === "robot" ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`${iconCls} opacity-50`}>
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
    </svg>
  ) : display.icon === "globe" ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${iconCls} opacity-50`}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" x2="22" y1="12" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${iconCls} opacity-50`}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );

  return (
    <details
      className={`w-fit max-w-full rounded-lg border ${resultError ? "border-destructive/30 bg-destructive/5" : "border-border bg-secondary"}`}
      open={isSpawnWithFeed && status === "running" ? true : undefined}
    >
      <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap max-w-full">
        {statusIcon || toolIcon}
        <span className="truncate">{display.label}</span>
        {status === "running" && !isSpawnWithFeed && <span className="ml-1.5 text-muted-foreground/60">running...</span>}
      </summary>
      {isSpawnWithFeed && (
        <SubagentActivityFeed getEntries={getEntries} storeVersion={subagentStore.versionRef} />
      )}
      {(args || result) && (
        <div className="overflow-hidden text-xs text-muted-foreground">
          {args && (
            <div className="border-t border-border px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Arguments</span>
              <div className="mt-1 flex flex-col gap-0.5">
                {(() => {
                  try {
                    const parsed = typeof args === "string" ? JSON.parse(args) : args;
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                      return Object.entries(parsed).map(([k, v]) => (
                        <div key={k} className="break-words">
                          <span className="font-semibold text-foreground/70">{k}</span>
                          <span className="text-muted-foreground/40"> — </span>
                          <span className="whitespace-pre-wrap break-words">{typeof v === "string" ? v : JSON.stringify(v)}</span>
                        </div>
                      ));
                    }
                  } catch {}
                  return <pre className="whitespace-pre-wrap break-words overflow-hidden">{formatJson(args)}</pre>;
                })()}
              </div>
            </div>
          )}
          {result && (
            <div className="border-t border-border px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Result</span>
              <pre className="mt-1 whitespace-pre-wrap break-words overflow-hidden">{result}</pre>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
