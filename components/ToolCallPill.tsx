"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from "react";
import { getToolDisplay, parseArgs } from "@mc/lib/toolDisplay";
import { SubagentActivityFeed } from "@mc/components/SubagentActivityFeed";
import { SlideContent } from "@mc/components/SlideContent";
import type { SubagentStore } from "@mc/hooks/useSubagentStore";
import {
  isEditTool,
  isReadTool,
  isGatewayTool,
  SPAWN_TOOL_NAME,
  SQUIRCLE_RADIUS,
  TOOL_CALL_BUBBLE_BG,
  TOOL_CALL_BUBBLE_BORDER,
  TOOL_CALL_BUBBLE_BORDER_ERROR,
  TOOL_CALL_BUBBLE_TEXT,
  TOOL_CALL_BUBBLE_MUTED,
  TOOL_CALL_BUBBLE_SHADOW,
} from "@mc/lib/constants";
import { useSwipeAction } from "@mc/hooks/useSwipeAction";

interface PinInfo {
  toolCallId: string | null;
  childSessionKey: string | null;
  taskName: string;
  model: string | null;
}

interface ToolCallPillProps {
  name: string;
  args?: string;
  status?: "running" | "success" | "error";
  result?: string;
  resultError?: boolean;
  narration?: string;
  toolCallId?: string;
  subagentStore?: SubagentStore;
  isPinned?: boolean;
  onPin?: (info: PinInfo) => void;
  onUnpin?: () => void;
}

type ToolBubbleStyle = CSSProperties & {
  "--foreground"?: string;
  "--card-foreground"?: string;
  "--muted-foreground"?: string;
};

function getToolBubbleStyle(expanded: boolean): ToolBubbleStyle {
  return {
    background: "transparent",
    borderTop: `1px solid ${expanded ? "var(--border)" : "transparent"}`,
    borderBottom: `1px solid ${expanded ? "var(--border)" : "transparent"}`,
    boxShadow: TOOL_CALL_BUBBLE_SHADOW,
    color: TOOL_CALL_BUBBLE_TEXT,
    "--foreground": TOOL_CALL_BUBBLE_TEXT,
    "--card-foreground": TOOL_CALL_BUBBLE_TEXT,
    "--muted-foreground": TOOL_CALL_BUBBLE_MUTED,
  };
}

function getSpawnBubbleStyle(resultError?: boolean): ToolBubbleStyle {
  return {
    borderRadius: `${SQUIRCLE_RADIUS}px`,
    background: TOOL_CALL_BUBBLE_BG,
    border: `1px solid ${resultError ? TOOL_CALL_BUBBLE_BORDER_ERROR : TOOL_CALL_BUBBLE_BORDER}`,
    boxShadow: TOOL_CALL_BUBBLE_SHADOW,
    color: TOOL_CALL_BUBBLE_TEXT,
    "--foreground": TOOL_CALL_BUBBLE_TEXT,
    "--card-foreground": TOOL_CALL_BUBBLE_TEXT,
    "--muted-foreground": TOOL_CALL_BUBBLE_MUTED,
  };
}

// ── Shared icon helpers ──────────────────────────────────────────────────────

const ICON_CLS = "relative top-[1px] inline-block mr-1.5 shrink-0 opacity-35";

function StatusIcon({ status, resultError }: { status?: string; resultError?: boolean }) {
  if (status === "running") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${ICON_CLS} animate-spin`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
  if (resultError) return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${ICON_CLS} text-destructive`}>
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
  return null;
}

function ToolIcon({ icon }: { icon: string }) {
  if (icon === "terminal") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
  if (icon === "file") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
  if (icon === "robot") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
    </svg>
  );
  if (icon === "gear") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
  if (icon === "globe") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
      <circle cx="12" cy="12" r="10" /><line x1="2" x2="22" y1="12" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"
      className="ml-1 shrink-0 opacity-35 transition-transform duration-200"
      style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function BottomChevronButton({ onToggle, label }: { onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onToggle}
      className="absolute left-1/2 z-10 flex h-5 w-16 -translate-x-1/2 cursor-pointer items-center justify-center text-foreground/45"
      style={{ background: "var(--background)", bottom: "-0.625rem" }}
    >
      <svg
        width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="m18 15-6-6-6 6" />
      </svg>
    </button>
  );
}

function hasSelectedTextWithin(target: HTMLElement) {
  if (typeof window === "undefined" || typeof window.getSelection !== "function") return false;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.toString().trim().length === 0) return false;

  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    if (target.contains(range.commonAncestorContainer)) return true;
  }

  return false;
}

function handleToggleKeyDown(event: ReactKeyboardEvent<HTMLElement>, onToggle: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onToggle();
}

function handleToggleMouseUp(event: ReactMouseEvent<HTMLElement>, onToggle: () => void) {
  if (event.button !== 0) return;
  if (hasSelectedTextWithin(event.currentTarget)) return;
  onToggle();
}

function handleToggleTouchEnd(_event: ReactTouchEvent<HTMLElement>, onToggle: () => void) {
  onToggle();
}

// ── Main export ──────────────────────────────────────────────────────────────

export function ToolCallPill({ name, args, status, result, resultError, narration, toolCallId, subagentStore, isPinned, onPin, onUnpin }: ToolCallPillProps) {
  const formatJson = (s: string) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };
  const display = getToolDisplay(name, args);
  const isEdit = isEditTool(name);
  const isRead = isReadTool(name);
  const isGateway = isGatewayTool(name);
  // Edit tools: start expanded if already complete (history load), animate only during streaming
  const [open, setOpen] = useState(() => isEdit && (!!result || status === "success" || status === "error"));
  const isSpawn = name === SPAWN_TOOL_NAME;

  // Animate open on mount for edit tools (streaming case only)
  useEffect(() => {
    if (!isEdit || result || status === "success" || status === "error") return;
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, [isEdit, result, status]);

  // ── Spawn pill: full-width animated card ───────────────────────────────────
  if (isSpawn) {
    return <SpawnPill args={args} status={status} result={result} resultError={resultError} toolCallId={toolCallId} subagentStore={subagentStore} isPinned={isPinned} onPin={onPin} onUnpin={onUnpin} />;
  }

  // ── Default pill: animated slide ───────────────────────────────────────────
  // Only count content that will actually render inside the expanded area:
  // - args section is hidden for read/gateway tools
  // - result section is hidden for edit tools
  const hasVisibleArgs = !!(args && !isRead && !isGateway);
  const hasVisibleResult = !!(result && !isEdit);
  const hasContent = hasVisibleArgs || hasVisibleResult || !!narration;
  const hasStatusIcon = status === "running" || resultError;
  const bubbleStyle = getToolBubbleStyle(open);
  const toggleOpen = () => setOpen((v) => !v);

  return (
    <div className={`relative w-fit max-w-full overflow-visible font-mono ${open ? "mb-5" : ""}`} style={bubbleStyle}>
      <div
        role={hasContent ? "button" : undefined}
        tabIndex={hasContent ? 0 : undefined}
        aria-expanded={hasContent ? open : undefined}
        onKeyDown={hasContent ? (event) => handleToggleKeyDown(event, toggleOpen) : undefined}
        onMouseUp={hasContent ? (event) => handleToggleMouseUp(event, toggleOpen) : undefined}
        onTouchEnd={hasContent ? (event) => handleToggleTouchEnd(event, toggleOpen) : undefined}
        className={`w-full px-4 py-2.5 text-left text-xs font-normal overflow-hidden text-ellipsis whitespace-nowrap max-w-full flex items-center select-text ${hasContent ? "cursor-pointer" : "cursor-default"}`}
      >
        {hasStatusIcon ? <StatusIcon status={status} resultError={resultError} /> : <ToolIcon icon={display.icon} />}
        {narration
          ? <span className="truncate">{narration}</span>
          : isEdit ? <><span className="font-medium opacity-70">edit</span>&nbsp;<span className="truncate">{display.label}</span></> : isRead ? <><span className="font-medium opacity-70">read</span>&nbsp;<span className="truncate">{display.label}</span></> : <span className="truncate">{display.label}</span>}
        {hasContent && <Chevron open={open} />}
        {status === "running" && <span className="ml-1.5 opacity-45 shrink-0">running...</span>}
      </div>
      {hasContent && (
        <SlideContent open={open}>
          <div
            className="overflow-hidden text-xs leading-[1.5] select-text"
            onMouseUp={(event) => handleToggleMouseUp(event, toggleOpen)}
          >
            {narration && (
              <div className="px-4 py-2.5">
                <span className="text-2xs font-normal opacity-45">Tool</span>
                <div className="mt-1">{display.label}</div>
              </div>
            )}
            {args && !isRead && !isGateway && (
              <div className="px-4 py-2.5">
                {(() => {
                  if (isEdit) {
                    try {
                      const parsed = typeof args === "string" ? JSON.parse(args) : args;
                      if (parsed && typeof parsed === "object") {
                        const oldStr = parsed.old_string ?? parsed.oldString ?? parsed.old_str ?? parsed.oldText ?? "";
                        const newStr = parsed.new_string ?? parsed.newString ?? parsed.new_str ?? parsed.newText ?? "";
                        const oldLines = String(oldStr).split("\n");
                        const newLines = String(newStr).split("\n");
                        return (
                          <pre className="whitespace-pre-wrap break-words overflow-hidden font-mono text-xs leading-[1.5]">
                              {oldLines.map((line, i) => (
                                <div key={`old-${i}`} className="bg-red-500/10 text-red-800 dark:text-red-400">
                                  <span className="select-none opacity-60">- </span>{line}
                                </div>
                              ))}
                              {newLines.map((line, i) => (
                                <div key={`new-${i}`} className="bg-green-500/10 text-green-800 dark:text-green-400">
                                  <span className="select-none opacity-60">+ </span>{line}
                                </div>
                              ))}
                            </pre>
                        );
                      }
                    } catch {}
                  }
                  return (
                    <>
                      <span className="text-2xs font-normal opacity-45">Arguments</span>
                      <div className="mt-1 flex flex-col gap-0.5">
                        {(() => {
                          try {
                            const parsed = typeof args === "string" ? JSON.parse(args) : args;
                            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                              return Object.entries(parsed).map(([k, v]) => (
                                <div key={k} className="break-words">
                                  <span className="font-medium opacity-70">{k}</span>
                                  <span className="opacity-30"> — </span>
                                  <span className="whitespace-pre-wrap break-words">{typeof v === "string" ? v : JSON.stringify(v)}</span>
                                </div>
                              ));
                            }
                          } catch {}
                          return <pre className="whitespace-pre-wrap break-words overflow-hidden">{formatJson(args)}</pre>;
                        })()}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            {result && !isEdit && (
              <div className="px-4 py-2.5">
                <span className="text-2xs font-normal opacity-45">Result</span>
                <pre className="mt-1 whitespace-pre-wrap break-words overflow-visible">{result}</pre>
              </div>
            )}
          </div>
        </SlideContent>
      )}
      {hasContent && open && (
        <BottomChevronButton onToggle={toggleOpen} label="Collapse tool call" />
      )}
    </div>
  );
}

// ── SpawnPill — full-width animated subagent card ────────────────────────────

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-35">
      <path d="M12 17v5" /><path d="M9 2h6l-1.5 4.5L18 9l-1 1h-5.5L9 17H7l2.5-7H4l-1-1 4.5-2.5L9 2z" transform="rotate(45 12 12)" />
    </svg>
  );
}

function SpawnPill({
  args, status, result, resultError, toolCallId, subagentStore, isPinned, onPin, onUnpin,
}: {
  args?: string;
  status?: "running" | "success" | "error";
  result?: string;
  resultError?: boolean;
  toolCallId?: string;
  subagentStore?: SubagentStore;
  isPinned?: boolean;
  onPin?: (info: PinInfo) => void;
  onUnpin?: () => void;
}) {
  // Start open when already complete (history load) — skip the expand animation
  const [open, setOpen] = useState(() => !!result || status === "success" || status === "error");
  const parsed = parseArgs(args);
  const task = typeof parsed?.task === "string" ? parsed.task : null;
  const model = typeof parsed?.model === "string" ? parsed.model : null;

  // Extract childSessionKey from the result JSON for direct session lookup
  const childSessionKey = (() => {
    if (!result) return null;
    try {
      const r = JSON.parse(result);
      return typeof r?.childSessionKey === "string" ? r.childSessionKey : null;
    } catch { return null; }
  })();

  // Look up subagent entries: try toolCallId link first, then direct session key
  const getEntries = useCallback(() => {
    if (!subagentStore) return null;
    if (toolCallId) {
      const via = subagentStore.getEntriesForToolCall(toolCallId);
      if (via) return via;
    }
    if (childSessionKey) {
      return subagentStore.getEntriesForSession(childSessionKey);
    }
    return null;
  }, [toolCallId, childSessionKey, subagentStore]);

  const hasFeed = !!subagentStore;
  const canToggle = !isPinned;
  const visibleOpen = open && canToggle;

  // Animate open on mount for streaming case only (not history)
  useEffect(() => {
    if (!isPinned && !open) {
      const raf = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [isPinned, open]);

  // Swipe left to pin/unpin
  const { offset, animating, pastThreshold, handlers } = useSwipeAction(
    useCallback(() => {
      if (isPinned) onUnpin?.();
      else onPin?.({ toolCallId: toolCallId || null, childSessionKey, taskName: task || "spawn agent", model });
    }, [isPinned, onPin, onUnpin, toolCallId, childSessionKey, task, model]),
    { disabled: !hasFeed }
  );
  const toggleOpen = () => setOpen((v) => !v);

  return (
    <div
      className="relative w-full overflow-hidden font-mono"
      style={getSpawnBubbleStyle(resultError)}
      {...handlers}
    >
      {/* Swipe action indicator (behind content) */}
      {hasFeed && offset !== 0 && (
        <div className="absolute right-0 inset-y-0 w-20 flex items-center justify-center">
          <div className={`flex flex-col items-center gap-0.5 text-2xs font-normal transition-opacity ${pastThreshold ? "opacity-85" : "opacity-45"}`}>
            <PinIcon pinned={!!isPinned} />
            <span>{isPinned ? "Unpin" : "Pin"}</span>
          </div>
        </div>
      )}
      {/* Sliding content */}
      <div
        className="rounded-[inherit]"
        style={{
          transform: offset !== 0 ? `translateX(${offset}px)` : undefined,
          transition: animating ? "transform 200ms ease-out" : "none",
        }}
      >
        <div
          role={canToggle ? "button" : undefined}
          tabIndex={canToggle ? 0 : undefined}
          aria-expanded={canToggle ? visibleOpen : undefined}
          onKeyDown={canToggle ? (event) => handleToggleKeyDown(event, toggleOpen) : undefined}
          onMouseUp={canToggle ? (event) => handleToggleMouseUp(event, toggleOpen) : undefined}
          onTouchEnd={canToggle ? (event) => handleToggleTouchEnd(event, toggleOpen) : undefined}
          className={`w-full px-4 py-2.5 text-left text-xs font-normal select-text ${canToggle ? "cursor-pointer" : "cursor-default"}`}
        >
          <div className="flex items-center gap-1">
            <StatusIcon status={status} resultError={resultError} />
            {!status || status === "success" ? <ToolIcon icon="robot" /> : null}
            <span className="truncate">{task || "spawn agent"}</span>
            <Chevron open={visibleOpen} />
            {isPinned && <PinIcon pinned />}
          </div>
          {model && (
            <div className="text-2xs text-muted-foreground/40 font-normal mt-0.5 ml-[18px]">{model}</div>
          )}
        </div>
        <SlideContent open={visibleOpen}>
          {hasFeed && (
            <SubagentActivityFeed getEntries={getEntries} storeVersion={subagentStore.versionRef} />
          )}
        </SlideContent>
      </div>
    </div>
  );
}
