"use client";

import { ChatHeader } from "@/components/ChatHeader";
import { SessionSheet } from "@/components/SessionSheet";
import { SetupDialog } from "@/components/SetupDialog";
import type { ConnectionState } from "@/lib/useWebSocket";
import type { BackendMode, ConnectionConfig, SessionInfo } from "@/types/chat";

interface ChatChromeProps {
  hideChrome: boolean;
  openclawUrl: string | null;
  isDemoMode: boolean;
  backendMode: BackendMode;
  showSetup: boolean;
  connectionError: string | null;
  onSetupConnect: (config: ConnectionConfig) => void;
  onCloseSetup: () => void;
  onOpenSetup: () => void;
  currentModel: string | null;
  theme: "light" | "dark";
  toggleTheme: () => void;
  zenMode: boolean;
  toggleZenMode: () => void;
  connectionState: ConnectionState;
  sessionName: string;
  onSessionPillClick: () => void;
  sessionSwitching: boolean;
  isSessionSheetOpen: boolean;
  onCloseSessionSheet: () => void;
  sessions: SessionInfo[];
  sessionsLoading: boolean;
  currentSessionKey: string;
  onSessionSelect: (key: string) => void;
}

export function ChatChrome({
  hideChrome,
  openclawUrl,
  isDemoMode,
  backendMode,
  showSetup,
  connectionError,
  onSetupConnect,
  onCloseSetup,
  onOpenSetup,
  currentModel,
  theme,
  toggleTheme,
  zenMode,
  toggleZenMode,
  connectionState,
  sessionName,
  onSessionPillClick,
  sessionSwitching,
  isSessionSheetOpen,
  onCloseSessionSheet,
  sessions,
  sessionsLoading,
  currentSessionKey,
  onSessionSelect,
}: ChatChromeProps) {
  if (hideChrome) return null;

  return (
    <>
      <SetupDialog
        onConnect={onSetupConnect}
        onClose={openclawUrl || isDemoMode || backendMode !== "openclaw" ? onCloseSetup : undefined}
        visible={showSetup}
        connectionError={connectionError}
      />
      <ChatHeader
        currentModel={currentModel}
        theme={theme}
        toggleTheme={toggleTheme}
        zenMode={zenMode}
        toggleZenMode={toggleZenMode}
        connectionState={connectionState}
        backendMode={backendMode}
        isDemoMode={isDemoMode}
        onOpenSetup={onOpenSetup}
        sessionName={sessionName}
        onSessionPillClick={onSessionPillClick}
        sessionSwitching={sessionSwitching}
      />
      <SessionSheet
        open={isSessionSheetOpen}
        onClose={onCloseSessionSheet}
        sessions={sessions}
        loading={sessionsLoading}
        currentSessionKey={currentSessionKey}
        onSelect={onSessionSelect}
      />
    </>
  );
}
