"use client";

import React from "react";

import { ChatInput, type ChatInputHandle } from "@/components/ChatInput";
import { FloatingSubagentPanel } from "@/components/FloatingSubagentPanel";
import { QueuePill } from "@/components/chat/QueuePill";
import type { Command } from "@/components/CommandSheet";
import type { useSubagentStore } from "@/hooks/useSubagentStore";
import type { BackendMode, ImageAttachment, ModelChoice } from "@/types/chat";

interface ChatComposerBarProps {
  isNative: boolean;
  isDetached: boolean;
  isStandalone: boolean;
  floatingBarRef: React.RefObject<HTMLDivElement | null>;
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
  quoteText: string | null;
  onClearQuote: () => void;
  isRunActive: boolean;
  hasQueued: boolean;
  onAbort: () => void;
  lastUserMessage: string;
  uploadDisabled: boolean;
}

export function ChatComposerBar({
  isNative,
  isDetached,
  isStandalone,
  floatingBarRef,
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
  quoteText,
  onClearQuote,
  isRunActive,
  hasQueued,
  onAbort,
  lastUserMessage,
  uploadDisabled,
}: ChatComposerBarProps) {
  if (isNative) return null;

  return (
    <div
      ref={floatingBarRef}
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-3 ${isDetached ? "pb-[1.5dvh]" : isStandalone ? "pb-[5.5dvh]" : "pb-[3dvh]"} md:px-6 ${isDetached ? "md:pb-[1.5dvh]" : isStandalone ? "md:pb-[5.5dvh]" : "md:pb-[3dvh]"} animate-[fadeIn_400ms_ease-out]`}
    >
      <div
        ref={morphRef}
        className="pointer-events-auto w-full"
        style={{ maxWidth: "min(calc(200px + (100% - 200px) * (1 - var(--lp, 0))), calc(200px + (42rem - 200px) * (1 - var(--lp, 0))))" } as React.CSSProperties}
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
          availableModels={availableModels}
          modelsLoading={modelsLoading}
          onFetchModels={onFetchModels}
          backendMode={backendMode}
          serverCommands={serverCommands}
          quoteText={quoteText}
          onClearQuote={onClearQuote}
          isRunActive={isRunActive}
          hasQueued={hasQueued}
          onAbort={onAbort}
          lastUserMessage={lastUserMessage}
          uploadDisabled={uploadDisabled}
        />
      </div>
    </div>
  );
}
