import type { BackendMode } from "@/types/chat";
import type { ConnectionState } from "@/lib/useWebSocket";

interface ChatHeaderProps {
  currentModel: string | null;
  theme: "light" | "dark";
  toggleTheme: () => void;
  zenMode: boolean;
  toggleZenMode: () => void;
  connectionState: ConnectionState;
  backendMode: BackendMode;
  isDemoMode: boolean;
  onOpenSetup: () => void;
  sessionName?: string;
  onSessionPillClick?: () => void;
  sessionSwitching?: boolean;
}

export function ChatHeader({
  currentModel,
  theme,
  toggleTheme,
  zenMode,
  toggleZenMode,
  connectionState,
  backendMode,
  isDemoMode,
  onOpenSetup,
  sessionName,
  onSessionPillClick,
  sessionSwitching,
}: ChatHeaderProps) {
  const isOpenClaw = backendMode === "openclaw" && !isDemoMode;
  const canSwitch = isOpenClaw && !!onSessionPillClick;
  const displayName = isOpenClaw && sessionName ? sessionName : "MobileClaw";

  const connectionLabel = isDemoMode || backendMode === "demo"
    ? "Demo"
    : backendMode === "lmstudio"
      ? "LM Studio"
      : connectionState === "connected"
        ? "Connected"
        : connectionState === "reconnecting"
          ? "Reconnecting..."
          : connectionState === "connecting"
            ? "Connecting..."
            : "Disconnected";

  const dotColor = isDemoMode || backendMode === "demo"
    ? "bg-blue-500"
    : backendMode === "lmstudio"
      ? "bg-green-500"
      : connectionState === "connected"
        ? "bg-green-500"
        : connectionState === "connecting" || connectionState === "reconnecting"
          ? "bg-yellow-500 animate-pulse"
          : "bg-red-500";

  return (
    <header className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 border-b border-border/50 px-4 py-3 font-[family-name:var(--font-geist-sans)] backdrop-blur-sm md:px-6" style={{ background: "oklch(from var(--card) l c h / 0.7)" }}>
      <button
        type="button"
        onClick={onOpenSetup}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-accent active:bg-accent"
        aria-label="Open settings"
      >
        <img src="/logo.png" alt="MobileClaw" className="h-7 dark:hidden" />
        <img src="/logo-dark.png" alt="MobileClaw" className="hidden h-7 dark:block" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col items-center">
        {canSwitch ? (
          <button
            type="button"
            onClick={onSessionPillClick}
            className="flex max-w-full items-center gap-1 transition-colors hover:text-foreground/80 active:text-foreground/60"
          >
            <span className="truncate text-xs text-muted-foreground">{displayName}</span>
            {sessionSwitching ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 animate-spin text-muted-foreground">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
                <path d="m6 9 6 6 6-6" />
              </svg>
            )}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">{displayName}</span>
        )}
        {currentModel && (
          <p className="truncate text-2xs text-muted-foreground/60 animate-[fadeIn_300ms_ease-out]">{currentModel}</p>
        )}
      </div>
      <button
        type="button"
        onClick={toggleTheme}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-accent active:bg-accent"
        aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      >
        {theme === "light" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={toggleZenMode}
        className={`flex h-8 w-8 items-center justify-center rounded-full border border-border transition-colors active:bg-accent ${
          zenMode
            ? "bg-accent text-foreground ring-1 ring-ring/60 hover:bg-accent/90"
            : "bg-card hover:bg-accent"
        }`}
        aria-pressed={zenMode}
        aria-label={zenMode ? "Disable zen mode" : "Enable zen mode"}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 100 100"
          fill="none"
          preserveAspectRatio="xMidYMid meet"
          className="block"
          aria-hidden="true"
        >
          <g stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="50" cy="50" r="46" />
            <path d="M50 4 A23 23 0 0 1 50 50 A23 23 0 0 0 50 96" />
          </g>
        </svg>
      </button>
      <div className="flex shrink-0 items-center animate-[fadeIn_300ms_ease-out]" title={connectionLabel} aria-label={connectionLabel}>
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      </div>
    </header>
  );
}
