"use client";

import { useEffect, useRef, useState } from "react";
import { SlideContent } from "@mc/components/SlideContent";
import { isToolCallPart, isEditTool, isReadTool, isGatewayTool } from "@mc/lib/constants";
import { getToolDisplay, humanizeToolName, parseArgs } from "@mc/lib/toolDisplay";
import { splitIntoSentences, unwrapLineUnderscoreEmphasis } from "@mc/lib/chat/thinkingUtils";
import type { ContentPart } from "@mc/types/chat";

// ── Icons ─────────────────────────────────────────────────────────────────────

const ICON_CLS = "shrink-0 opacity-40";

function BrainIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${ICON_CLS} animate-spin`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${ICON_CLS} text-destructive opacity-70`}>
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function ToolIconEl({ icon }: { icon: string }) {
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
  if (icon === "globe") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
      <circle cx="12" cy="12" r="10" /><line x1="2" x2="22" y1="12" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
  if (icon === "gear") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function RowChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"
      className="ml-auto shrink-0 opacity-35 transition-transform duration-200"
      style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// ── Expanded content helpers ──────────────────────────────────────────────────

function ThinkingExpandedContent({ text }: { text: string }) {
  const displayText = unwrapLineUnderscoreEmphasis(text);
  return (
    <div className="w-full overflow-hidden px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-[#8D8D8D] select-text">
      {displayText || <span className="opacity-50 italic">empty</span>}
    </div>
  );
}

function ToolExpandedContent({ name, args, result, resultError, narration }: {
  name: string;
  args?: string;
  result?: string;
  resultError?: boolean;
  narration?: string;
}) {
  const display = getToolDisplay(name, args);
  const isEdit = isEditTool(name);
  const isRead = isReadTool(name);
  const isGateway = isGatewayTool(name);
  const hasArgs = !!(args && !isRead && !isGateway);
  const hasResult = !!(result && !isEdit);

  if (!hasArgs && !hasResult && !narration) return null;

  return (
    <div className="w-full overflow-hidden text-[13px] leading-relaxed select-text">
      {narration && (
        <div className="px-3 py-2 text-[#8D8D8D]">
          <span className="opacity-50 text-[10px] uppercase tracking-wide" style={{ fontFamily: "system-ui" }}>Tool</span>
          <div className="mt-0.5 font-mono">{display.label}</div>
        </div>
      )}
      {hasArgs && (
        <div className="px-3 py-2 text-[#8D8D8D]">
          {isEdit ? (() => {
            try {
              const parsed = JSON.parse(args!);
              const oldStr = String(parsed.old_string ?? parsed.oldString ?? parsed.old_str ?? parsed.oldText ?? "");
              const newStr = String(parsed.new_string ?? parsed.newString ?? parsed.new_str ?? parsed.newText ?? "");
              return (
                <pre className="whitespace-pre-wrap break-words overflow-hidden font-mono text-[13px] leading-[1.5]">
                  {oldStr.split("\n").map((line, i) => (
                    <div key={`old-${i}`} className="bg-red-500/10 text-red-800 dark:text-red-400">
                      <span className="select-none opacity-60">- </span>{line}
                    </div>
                  ))}
                  {newStr.split("\n").map((line, i) => (
                    <div key={`new-${i}`} className="bg-green-500/10 text-green-800 dark:text-green-400">
                      <span className="select-none opacity-60">+ </span>{line}
                    </div>
                  ))}
                </pre>
              );
            } catch {
              return <pre className="whitespace-pre-wrap break-words overflow-hidden font-mono">{args}</pre>;
            }
          })() : (() => {
            const parsed = parseArgs(args);
            if (parsed) {
              return (
                <div className="font-mono space-y-0.5">
                  {Object.entries(parsed).map(([k, v]) => (
                    <div key={k}>
                      <span className="opacity-50">{k}: </span>
                      <span className="break-all">{typeof v === "string" ? v : JSON.stringify(v)}</span>
                    </div>
                  ))}
                </div>
              );
            }
            return <pre className="whitespace-pre-wrap break-words overflow-hidden font-mono">{args}</pre>;
          })()}
        </div>
      )}
      {hasResult && (
        <div className={`px-3 py-2 font-mono ${resultError ? "text-destructive/80" : "text-[#8D8D8D]"}`}>
          <span className="opacity-50 text-[10px] uppercase tracking-wide" style={{ fontFamily: "system-ui" }}>{resultError ? "Error" : "Result"}</span>
          <pre className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.5] max-h-40 overflow-y-auto overflow-x-hidden">{result}</pre>
        </div>
      )}
    </div>
  );
}

function getEffectiveToolNarration(part: ContentPart): string | undefined {
  if (part.type === "thinking") return undefined;

  const topLevelNarration = typeof part.narration === "string" ? part.narration.trim() : "";
  if (topLevelNarration) return topLevelNarration;

  const rawArgs = part.arguments;
  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    const fromObject = (rawArgs as Record<string, unknown>).narration;
    if (typeof fromObject === "string") {
      const trimmed = fromObject.trim();
      if (trimmed) return trimmed;
    }
    return undefined;
  }

  if (typeof rawArgs === "string") {
    const parsed = parseArgs(rawArgs);
    const fromParsed = parsed?.narration;
    if (typeof fromParsed === "string") {
      const trimmed = fromParsed.trim();
      if (trimmed) return trimmed;
    }
  }

  return undefined;
}

// ── Row ───────────────────────────────────────────────────────────────────────

function ActivityRow({
  part,
  open,
  onToggle,
  isFirst,
  isLast,
  isStreamingThisPart,
}: {
  part: ContentPart;
  open: boolean;
  onToggle: () => void;
  isFirst: boolean;
  isLast: boolean;
  isStreamingThisPart: boolean;
}) {
  const isThinking = part.type === "thinking";
  const toolNarration = isThinking ? undefined : getEffectiveToolNarration(part);

  // Compute row label
  let label: string;
  if (isThinking) {
    const text = unwrapLineUnderscoreEmphasis(part.thinking || part.text || "");
    if (!text.trim()) {
      label = "Thinking\u2026";
    } else {
      const sentences = splitIntoSentences(text);
      label = sentences[0] ?? text.slice(0, 100);
    }
  } else {
    const toolLabel = humanizeToolName(part.name || "tool");
    label = toolNarration ? `${toolLabel} | ${toolNarration}` : toolLabel;
  }

  const isRunning = !isThinking && part.status === "running";
  const isError = !isThinking && part.resultError;
  const hasExpandedContent = isThinking
    ? !!(part.thinking || part.text)
    : !!(toolNarration || (part.arguments && !isReadTool(part.name || "") && !isGatewayTool(part.name || "")) || (part.result && !isEditTool(part.name || "")));

  return (
    <div>
      <button
        type="button"
        onClick={hasExpandedContent ? onToggle : undefined}
        className={`w-full px-3 py-2 text-[13px] flex items-center gap-2 text-left ${hasExpandedContent ? "cursor-pointer" : "cursor-default"}`}
        style={{ color: "rgba(0,0,0,0.6)" }}
      >
        <span className="relative flex w-4 shrink-0 items-center justify-center self-stretch" aria-hidden="true">
          {!isFirst && (
            <span className="pointer-events-none absolute left-1/2 top-[-8px] h-[5px] w-[0.5px] -translate-x-1/2 rounded-full bg-foreground/28" />
          )}
          {!isLast && (
            <span className="pointer-events-none absolute left-1/2 bottom-[-8px] h-[5px] w-[0.5px] -translate-x-1/2 rounded-full bg-foreground/28" />
          )}
          {/* Icon */}
          {isThinking
            ? (isStreamingThisPart && !(part.thinking || part.text) ? <SpinnerIcon /> : <BrainIcon />)
            : isRunning ? <SpinnerIcon />
            : isError ? <ErrorIcon />
            : <ToolIconEl icon={getToolDisplay(part.name || "tool", part.arguments).icon} />
          }
        </span>
        {/* Label */}
        <span className="truncate flex-1 min-w-0 text-[13px]" style={{ fontFamily: "system-ui" }}>
          {label}
          {isRunning && <span className="ml-1.5 opacity-45">{"running\u2026"}</span>}
        </span>
        {/* Chevron */}
        {hasExpandedContent && <RowChevron open={open} />}
      </button>
      {hasExpandedContent && (
        <SlideContent open={open}>
          {isThinking
            ? <ThinkingExpandedContent text={part.thinking || part.text || ""} />
            : <ToolExpandedContent
                name={part.name || "tool"}
                args={typeof part.arguments === "string" ? part.arguments : part.arguments ? JSON.stringify(part.arguments) : undefined}
                result={part.result}
                resultError={part.resultError}
                narration={toolNarration}
              />
          }
        </SlideContent>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface TurnActivityBoxProps {
  parts: ContentPart[];
  isStreaming: boolean;
}

export function TurnActivityBox({ parts, isStreaming }: TurnActivityBoxProps) {
  const [rowOpen, setRowOpen] = useState<boolean[]>(() => parts.map(() => false));

  // Grow rowOpen array as new parts stream in
  useEffect(() => {
    setRowOpen((prev) => {
      if (prev.length >= parts.length) return prev;
      return [...prev, ...parts.slice(prev.length).map(() => false)];
    });
  }, [parts.length]);

  // Auto-expand running tools, auto-collapse when done
  const prevStatusRef = useRef<(string | undefined)[]>([]);
  useEffect(() => {
    parts.forEach((part, i) => {
      const prev = prevStatusRef.current[i];
      const curr = isToolCallPart(part) ? part.status : undefined;
      if (curr === "running" && prev !== "running") {
        setRowOpen((r) => { const n = [...r]; n[i] = true; return n; });
      }
      if ((curr === "success" || curr === "error") && prev === "running") {
        const idx = i;
        setTimeout(() => setRowOpen((r) => { const n = [...r]; n[idx] = false; return n; }), 400);
      }
    });
    prevStatusRef.current = parts.map((p) => isToolCallPart(p) ? p.status : undefined);
  }, [parts]);

  if (parts.length === 0) return null;

  const toggleRow = (i: number) => setRowOpen((r) => { const n = [...r]; n[i] = !n[i]; return n; });

  return (
    <div className="w-full rounded-lg overflow-hidden border border-border font-mono text-[13px]">
      {parts.map((part, i) => (
        <ActivityRow
          key={i}
          part={part}
          open={rowOpen[i] ?? false}
          onToggle={() => toggleRow(i)}
          isFirst={i === 0}
          isLast={i === parts.length - 1}
          isStreamingThisPart={isStreaming && i === parts.length - 1}
        />
      ))}
    </div>
  );
}
