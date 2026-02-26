"use client";

import React from "react";

import { MessageRow } from "@/components/MessageRow";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { formatMessageTime, getMessageSide } from "@/lib/messageUtils";
import type { Message } from "@/types/chat";
import type { useSubagentStore } from "@/hooks/useSubagentStore";

interface ChatViewportProps {
  isDetached: boolean;
  isNative: boolean;
  historyLoaded: boolean;
  inputZoneHeight: string;
  bottomPad: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  pullContentRef: React.RefObject<HTMLDivElement | null>;
  pullSpinnerRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onNativeScrollPosition?: (distanceFromBottom: number) => void;
  displayMessages: Message[];
  sentAnimId: string | null;
  onSentAnimationEnd: () => void;
  fadeInIds: Set<string>;
  isStreaming: boolean;
  streamingId: string | null;
  subagentStore: ReturnType<typeof useSubagentStore>;
  pinnedToolCallId: string | null;
  onPin: (info: {
    toolCallId: string | null;
    childSessionKey: string | null;
    taskName: string;
    model: string | null;
  }) => void;
  onUnpin: () => void;
  awaitingResponse: boolean;
  thinkingStartTime: number | null;
  thinkingLabel?: string;
  quotePopup: { x: number; y: number; text: string } | null;
  quotePopupRef: React.RefObject<HTMLButtonElement | null>;
  onAcceptQuote: (text: string) => void;
}

export function ChatViewport({
  isDetached,
  isNative,
  historyLoaded,
  inputZoneHeight,
  bottomPad,
  scrollRef,
  bottomRef,
  pullContentRef,
  pullSpinnerRef,
  onScroll,
  onNativeScrollPosition,
  displayMessages,
  sentAnimId,
  onSentAnimationEnd,
  fadeInIds,
  isStreaming,
  streamingId,
  subagentStore,
  pinnedToolCallId,
  onPin,
  onUnpin,
  awaitingResponse,
  thinkingStartTime,
  thinkingLabel,
  quotePopup,
  quotePopupRef,
  onAcceptQuote,
}: ChatViewportProps) {
  return (
    <div ref={pullContentRef} className={`relative flex flex-1 flex-col min-h-0 ${isDetached ? "px-3 pt-3" : ""}`}>
      {!isNative && <div className={`pointer-events-none absolute z-20 h-7 opacity-60 ${isDetached ? "inset-x-3 top-3 rounded-t-2xl" : "inset-x-0 top-[60px]"}`} style={{ background: "linear-gradient(to bottom, var(--background) 40%, transparent)" }} />}
      {!isNative && <div className={`pointer-events-none absolute z-20 h-7 opacity-60 ${isDetached ? "inset-x-3 rounded-b-2xl" : "inset-x-0"}`} style={{ bottom: isDetached ? inputZoneHeight : 0, background: "linear-gradient(to top, var(--background) 40%, transparent)" }} />}
      <main
        ref={scrollRef}
        onScroll={() => {
          onScroll();
          if (onNativeScrollPosition && scrollRef.current) {
            const el = scrollRef.current;
            const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            onNativeScrollPosition(distFromBottom);
          }
        }}
        className={`scrollbar-hide flex-1 overflow-y-auto overflow-x-hidden ${isNative ? "" : "bg-background"} ${isDetached ? "rounded-2xl" : "pt-14"}`}
        style={{ ...(isNative ? {} : { overscrollBehavior: "none" as const }), ...(isDetached ? { boxShadow: "0 -4px 6px -1px rgb(0 0 0 / 0.06), 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)" } : {}) }}
      >
        <div className={`mx-auto flex w-full ${isDetached || isNative ? "max-w-none" : "max-w-2xl"} flex-col gap-3 px-4 py-6 md:px-6 md:py-4 transition-opacity duration-300 ease-out ${historyLoaded ? "opacity-100" : "opacity-0"}`} style={{ paddingBottom: bottomPad }}>
          {displayMessages.map((msg, idx) => {
            const side = getMessageSide(msg.role);
            const prevSide = idx > 0 ? getMessageSide(displayMessages[idx - 1].role) : null;
            const prevTimestamp = idx > 0 ? displayMessages[idx - 1].timestamp : null;
            const isNewTurn = side !== "center" && side !== prevSide;
            const timGap = msg.timestamp && prevTimestamp ? msg.timestamp - prevTimestamp : 0;
            const isTimeGap = timGap > 10 * 60 * 1000;
            const showTimestamp = side !== "center" && (isNewTurn || isTimeGap);
            return (
              <React.Fragment key={msg.id || idx}>
                {isTimeGap && !isNewTurn && msg.timestamp && (
                  <div className="flex justify-center py-1">
                    <span className="text-2xs text-muted-foreground/60">{formatMessageTime(msg.timestamp)}</span>
                  </div>
                )}
                {showTimestamp && isNewTurn && msg.timestamp && (
                  <p className={`text-2xs text-muted-foreground/60 ${side === "right" ? "text-right" : "text-left"}`}>
                    {formatMessageTime(msg.timestamp)}
                    {msg.role === "assistant" && msg.runDuration && msg.runDuration > 0 && (
                      <span className="ml-1">&middot; Worked for {msg.runDuration}s</span>
                    )}
                    {msg.role === "assistant" && !msg.runDuration && msg.thinkingDuration && msg.thinkingDuration > 0 && (
                      <span className="ml-1">&middot; {msg.thinkingDuration}s</span>
                    )}
                  </p>
                )}
                <div
                  style={
                    msg.id === sentAnimId
                      ? { animation: "messageSend 350ms cubic-bezier(0.34, 1.56, 0.64, 1) both", transformOrigin: "bottom right" }
                      : msg.id && fadeInIds.has(msg.id)
                        ? { animation: "fadeIn 250ms ease-out" }
                        : undefined
                  }
                  onAnimationEnd={msg.id === sentAnimId ? onSentAnimationEnd : undefined}
                >
                  <MessageRow
                    message={msg}
                    isStreaming={isStreaming && msg.id === streamingId}
                    subagentStore={subagentStore}
                    pinnedToolCallId={pinnedToolCallId}
                    onPin={onPin}
                    onUnpin={onUnpin}
                  />
                </div>
              </React.Fragment>
            );
          })}
          <ThinkingIndicator visible={awaitingResponse} startTime={thinkingStartTime ?? undefined} label={thinkingLabel} />
          <div ref={bottomRef} />
        </div>
      </main>

      {isDetached && !isNative && <div style={{ height: inputZoneHeight, flexShrink: 0 }} />}

      {!isDetached && !isNative && (
        <div
          ref={pullSpinnerRef}
          className="flex h-0 items-center justify-center gap-2 overflow-visible"
          style={{ opacity: 0, transform: "translateY(calc(-3dvh - 23px))" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground" style={{ animation: "none" }}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span className="text-sm leading-none">🦞</span>
        </div>
      )}

      {quotePopup && !isNative && (
        <button
          ref={quotePopupRef}
          type="button"
          className="fixed z-50 -translate-x-1/2 -translate-y-full flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg active:scale-95 transition-transform animate-[fadeIn_100ms_ease-out]"
          style={{ left: quotePopup.x, top: quotePopup.y - 8 }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAcceptQuote(quotePopup.text);
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
            <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
          </svg>
          Quote
        </button>
      )}
    </div>
  );
}
