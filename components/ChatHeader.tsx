import type { BackendMode } from "@/types/chat";
import type { ConnectionState } from "@/lib/useWebSocket";

interface ChatHeaderProps {
  currentModel: string | null;
  theme: "light" | "dark";
  toggleTheme: () => void;
  connectionState: ConnectionState;
  backendMode: BackendMode;
  isDemoMode: boolean;
  onOpenSetup: () => void;
}

export function ChatHeader({
  currentModel,
  theme,
  toggleTheme,
  connectionState,
  backendMode,
  isDemoMode,
  onOpenSetup,
}: ChatHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl md:px-6">
      <button
        type="button"
        onClick={onOpenSetup}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-accent active:bg-accent"
        aria-label="Open settings"
      >
        <img src="/logo.png" alt="MobileClaw" className="h-7 mix-blend-multiply dark:mix-blend-screen dark:invert" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="text-sm font-semibold text-foreground">MobileClaw</h1>
        {currentModel && (
          <p className="truncate text-[11px] text-muted-foreground animate-[fadeIn_300ms_ease-out]">{currentModel}</p>
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
      <div className="flex shrink-0 flex-col items-end gap-0.5 animate-[fadeIn_300ms_ease-out]">
        <div className="flex items-center gap-1.5">
          {isDemoMode || backendMode === "demo" ? (
            <>
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <span className="text-[11px] text-muted-foreground">Demo</span>
            </>
          ) : backendMode === "lmstudio" ? (
            <>
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-[11px] text-muted-foreground">LM Studio</span>
            </>
          ) : (
            <>
              <span className={`h-2 w-2 rounded-full ${connectionState === "connected"
                ? "bg-green-500"
                : connectionState === "connecting" || connectionState === "reconnecting"
                  ? "bg-yellow-500 animate-pulse"
                  : "bg-red-500"
                }`} />
              <span className="text-[11px] text-muted-foreground">
                {connectionState === "connected"
                  ? "Connected"
                  : connectionState === "reconnecting"
                    ? "Reconnecting..."
                    : connectionState === "connecting"
                      ? "Connecting..."
                      : "Disconnected"}
              </span>
            </>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground/60 font-mono">{process.env.NEXT_PUBLIC_GIT_SHA}</span>
      </div>
    </header>
  );
}
