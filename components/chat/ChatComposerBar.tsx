"use client";

import React from "react";

import { ChatInput, type ChatInputHandle } from "@mc/components/ChatInput";
import { FloatingSubagentPanel } from "@mc/components/FloatingSubagentPanel";
import { QueuePill } from "@mc/components/chat/QueuePill";
import type { Command } from "@mc/components/CommandSheet";
import type { useSubagentStore } from "@mc/hooks/useSubagentStore";
import type { BackendMode, ImageAttachment, InputAttachment, ModelChoice } from "@mc/types/chat";

interface ChatComposerBarProps {
  isNative: boolean;
  isDetached: boolean;
  useDocumentScroll?: boolean;
  floatingBarRef: React.RefObject<HTMLDivElement | null>;
  footerReserveRef?: React.RefObject<HTMLDivElement | null>;
  morphRef: React.RefObject<HTMLDivElement | null>;
  pinnedSubagent: {
    toolCallId: string | null;
    childSessionKey: string | null;
    taskName: string;
    model: string | null;
  } | null;
  subagentStore: ReturnType<typeof useSubagentStore>;
  onUnpinSubagent: () => void;
  queuedMessage: { text: string; attachments?: ImageAttachment[] } | null;
  onDismissQueuedMessage: () => void;
  chatInputRef: React.RefObject<ChatInputHandle | null>;
  onSend: (text: string, attachments?: ImageAttachment[]) => void;
  scrollPhase: "input" | "pill";
  onScrollToBottom: () => void;
  availableModels: ModelChoice[];
  modelsLoading: boolean;
  onFetchModels: () => void;
  backendMode: BackendMode;
  serverCommands: Command[];
  attachments: InputAttachment[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (index: number) => void;
  onClearAll: () => void;
  isRunActive: boolean;
  hasQueued: boolean;
  onAbort: () => void;
  lastUserMessage: string;
  uploadDisabled: boolean;
}

export function ChatComposerBar({
  isNative,
  isDetached,
  useDocumentScroll = false,
  floatingBarRef,
  footerReserveRef,
  morphRef,
  pinnedSubagent,
  subagentStore,
  onUnpinSubagent,
  queuedMessage,
  onDismissQueuedMessage,
  chatInputRef,
  onSend,
  scrollPhase,
  onScrollToBottom,
  availableModels,
  modelsLoading,
  onFetchModels,
  backendMode,
  serverCommands,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onClearAll,
  isRunActive,
  hasQueued,
  onAbort,
  lastUserMessage,
  uploadDisabled,
}: ChatComposerBarProps) {
  if (isNative) return null;

  const showScrollPill = scrollPhase === "pill";
  const documentScrollClassName = "pointer-events-none relative z-20 flex justify-center px-3 md:px-6 animate-[fadeIn_400ms_ease-out]";
  const wrapperClassName = useDocumentScroll
    ? documentScrollClassName
    : `pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-3 ${isDetached ? "pb-[1.5dvh]" : "pb-[3dvh]"} md:px-6 ${isDetached ? "md:pb-[1.5dvh]" : "md:pb-[3dvh]"} animate-[fadeIn_400ms_ease-out]`;
  const wrapperStyle = useDocumentScroll
    ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }
    : undefined;
  const scrollPillOffset = useDocumentScroll
    ? "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)"
    : isDetached
      ? "calc(1.5dvh + 4.5rem)"
      : "calc(3dvh + 4.5rem)";
  const scrollPillContainerStyle = useDocumentScroll
    ? { bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.8rem)" }
    : { paddingBottom: scrollPillOffset };
  const scrollPill = showScrollPill ? (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 md:px-6 animate-[fadeIn_200ms_ease-out]"
      style={scrollPillContainerStyle}
    >
      <button
        type="button"
        onClick={onScrollToBottom}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-background/75 px-4 py-2.5 text-xs font-medium text-foreground shadow-[0_2px_4px_rgba(49,49,49,0.08)] backdrop-blur-[12px] backdrop-saturate-[1.8]"
      >
        <span aria-hidden="true" className="text-sm leading-none">↓</span>
        <span>Scroll to bottom</span>
      </button>
    </div>
  ) : null;

  const renderComposer = (ref: React.RefObject<HTMLDivElement | null>) => (
    <div
      ref={ref}
      className={wrapperClassName}
      style={wrapperStyle}
    >
      <div
        ref={morphRef}
        className="pointer-events-auto w-full"
        style={{ maxWidth: "42rem" } as React.CSSProperties}
      >
        {pinnedSubagent && (
          <div style={{ paddingLeft: "calc(48px * (1 - var(--lp, 0)))", paddingRight: "calc(48px * (1 - var(--lp, 0)))" } as React.CSSProperties}>
            <FloatingSubagentPanel
              toolCallId={pinnedSubagent.toolCallId}
              childSessionKey={pinnedSubagent.childSessionKey}
              taskName={pinnedSubagent.taskName}
              model={pinnedSubagent.model}
              subagentStore={subagentStore}
              onUnpin={onUnpinSubagent}
            />
          </div>
        )}

        {queuedMessage && (
          <div style={{ paddingLeft: "calc(48px * (1 - var(--lp, 0)))", paddingRight: "calc(48px * (1 - var(--lp, 0)))" } as React.CSSProperties}>
            <QueuePill text={queuedMessage.text} onDismiss={onDismissQueuedMessage} />
          </div>
        )}

        <ChatInput
          ref={chatInputRef}
          onSend={onSend}
          scrollPhase={scrollPhase}
          onScrollToBottom={onScrollToBottom}
          disableScrollMorph
          availableModels={availableModels}
          modelsLoading={modelsLoading}
          onFetchModels={onFetchModels}
          backendMode={backendMode}
          serverCommands={serverCommands}
          attachments={attachments}
          onAddFiles={onAddFiles}
          onRemoveAttachment={onRemoveAttachment}
          onClearAll={onClearAll}
          isRunActive={isRunActive}
          hasQueued={hasQueued}
          onAbort={onAbort}
          lastUserMessage={lastUserMessage}
          uploadDisabled={uploadDisabled}
        />
      </div>
    </div>
  );

  if (!useDocumentScroll) {
    return (
      <>
        {renderComposer(floatingBarRef)}
        {scrollPill}
      </>
    );
  }

  return (
    <>
      {renderComposer(footerReserveRef ?? floatingBarRef)}
      {scrollPill}
    </>
  );
}
