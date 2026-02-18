"use client";

import { useState, useRef, useEffect } from "react";
import type { ModelChoice } from "@/types/chat";

export interface Command {
  name: string;
  description: string;
  aliases?: string[];
}

export interface CommandGroup {
  label: string;
  commands: Command[];
}

export const COMMAND_GROUPS: CommandGroup[] = [
  {
    label: "Status",
    commands: [
      { name: "/help", description: "Show available commands." },
      { name: "/commands", description: "List all slash commands." },
      { name: "/status", description: "Show current status." },
      { name: "/model", description: "Show or change the current AI model." },
      { name: "/context", description: "Explain how context is built and used." },
      { name: "/whoami", description: "Show your sender id.", aliases: ["/id"] },
    ],
  },
  {
    label: "Management",
    commands: [
      { name: "/queue", description: "Adjust queue settings." },
      { name: "/allowlist", description: "List/add/remove allowlist entries." },
      { name: "/approve", description: "Approve or deny exec requests." },
      { name: "/subagents", description: "List/stop/log/info subagent runs for this session." },
      { name: "/config", description: "Show or set config values." },
      { name: "/activation", description: "Set group activation mode." },
      { name: "/send", description: "Set send policy." },
    ],
  },
  {
    label: "Media",
    commands: [
      { name: "/tts", description: "Control text-to-speech (TTS)." },
    ],
  },
  {
    label: "Tools",
    commands: [
      { name: "/skill", description: "Run a skill by name." },
      { name: "/restart", description: "Restart OpenClaw." },
      { name: "/apple_notes", description: "Manage Apple Notes via the memo CLI on macOS." },
      { name: "/apple_reminders", description: "Manage Apple Reminders via the remindctl CLI on macOS." },
      { name: "/bluebubbles", description: "Build or update the BlueBubbles external channel plugin." },
      { name: "/clawhub", description: "Search, install, update, and publish agent skills." },
      { name: "/coding_agent", description: "Run Codex CLI, Claude Code, or Pi Coding Agent." },
      { name: "/gemini", description: "Gemini CLI for one-shot Q&A, summaries, and generation." },
      { name: "/github", description: "Interact with GitHub using the gh CLI." },
      { name: "/healthcheck", description: "Host security hardening and risk-tolerance config." },
      { name: "/nano_banana_pro", description: "Generate or edit images via Gemini 3 Pro Image." },
      { name: "/openai_image_gen", description: "Batch-generate images via OpenAI Images API." },
      { name: "/openai_whisper_api", description: "Transcribe audio via OpenAI Whisper." },
      { name: "/peekaboo", description: "Capture and automate macOS UI with Peekaboo CLI." },
      { name: "/session_logs", description: "Search and analyze your own session logs." },
      { name: "/skill_creator", description: "Create or update AgentSkills." },
      { name: "/tmux", description: "Remote-control tmux sessions." },
      { name: "/video_frames", description: "Extract frames or clips from videos using ffmpeg." },
      { name: "/weather", description: "Get current weather and forecasts." },
      { name: "/apple_calendar", description: "Apple Calendar.app integration for macOS." },
      { name: "/claude_image_analyzer", description: "Describe images in detail using Claude Code CLI." },
      { name: "/google_workspace", description: "Interact with Google Workspace services." },
      { name: "/research", description: "Deep research methodology for sub-agents." },
      { name: "/youtube", description: "Summarize YouTube videos, extract transcripts." },
    ],
  },
  {
    label: "Docks",
    commands: [
      { name: "/dock_telegram", description: "Switch to Telegram for replies.", aliases: ["/dock-telegram"] },
      { name: "/dock_discord", description: "Switch to Discord for replies.", aliases: ["/dock-discord"] },
      { name: "/dock_slack", description: "Switch to Slack for replies.", aliases: ["/dock-slack"] },
    ],
  },
];

export const ALL_COMMANDS: Command[] = COMMAND_GROUPS.flatMap((g) => g.commands);

export function CommandSheet({
  open,
  onClose,
  onSelect,
  onSend,
  availableModels = [],
  modelsLoading = false,
  onFetchModels,
  backendMode = "openclaw",
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (command: string) => void;
  onSend?: (command: string) => void;
  availableModels?: ModelChoice[];
  modelsLoading?: boolean;
  onFetchModels?: () => void;
  backendMode?: "openclaw" | "lmstudio" | "demo";
}) {
  const [search, setSearch] = useState("");
  const [showModels, setShowModels] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Reset state when sheet closes
  useEffect(() => {
    if (!open) {
      setSearch("");
      setShowModels(false);
    }
  }, [open]);

  // Fetch models when entering model view (only for OpenClaw)
  useEffect(() => {
    if (showModels && backendMode === "openclaw" && availableModels.length === 0 && !modelsLoading) {
      onFetchModels?.();
    }
  }, [showModels, backendMode, availableModels.length, modelsLoading, onFetchModels]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const filteredGroups = COMMAND_GROUPS.map((group) => ({
    ...group,
    commands: group.commands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(search.toLowerCase()) ||
        cmd.description.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((g) => g.commands.length > 0);

  // Filter models based on search
  const filteredModels = availableModels.filter((m) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      m.id.toLowerCase().includes(term) ||
      m.name.toLowerCase().includes(term) ||
      m.provider.toLowerCase().includes(term)
    );
  });

  const handleCommandClick = (cmd: Command) => {
    // Special handling for /model command
    if (cmd.name === "/model" || cmd.name === "/models") {
      setShowModels(true);
      setSearch("");
      return;
    }
    onSelect(cmd.name + " ");
    onClose();
  };

  const handleModelClick = (model: ModelChoice) => {
    const command = `/model ${model.id}`;
    if (onSend) {
      onSend(command);
    } else {
      onSelect(command);
    }
    onClose();
  };

  const handleBackToCommands = () => {
    setShowModels(false);
    setSearch("");
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-foreground/10 backdrop-blur-sm transition-[opacity,visibility] duration-200 ${open ? "visible opacity-100" : "invisible opacity-0 pointer-events-none"}`}
        onClick={onClose}
        onMouseDown={onClose}
        role="button"
        tabIndex={-1}
        aria-label="Close commands"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Commands"
        className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[70dvh] flex-col rounded-t-2xl border-t border-border bg-background shadow-lg transition-[transform,visibility] duration-300 ease-out ${open ? "visible translate-y-0" : "invisible translate-y-full pointer-events-none"}`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        {/* Header with back button for model view */}
        {showModels && (
          <div className="flex items-center gap-2 px-4 pb-2 pt-1">
            <button
              type="button"
              onClick={handleBackToCommands}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Back to commands"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <span className="text-sm font-medium text-foreground">Select Model</span>
          </div>
        )}

        {/* Search */}
        <div className="px-4 pb-3 pt-1">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={showModels ? "Search models..." : "Search commands..."}
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus={open}
            />
          </div>
        </div>

        {/* Model list */}
        {showModels && (
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
            {modelsLoading && filteredModels.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Loading models...
              </div>
            )}
            {!modelsLoading && filteredModels.length === 0 && availableModels.length === 0 && backendMode !== "openclaw" && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Model selection is only available in OpenClaw mode
              </p>
            )}
            {!modelsLoading && filteredModels.length === 0 && availableModels.length > 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No models match "{search}"
              </p>
            )}
            {filteredModels.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {filteredModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => handleModelClick(model)}
                    className="flex items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent active:bg-accent"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">{model.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {model.provider}
                        {model.contextWindow && ` · ${Math.round(model.contextWindow / 1000)}k context`}
                        {model.reasoning && " · reasoning"}
                      </span>
                    </div>
                    <span className="mt-0.5 shrink-0 rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {model.id}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Command list */}
        {!showModels && (
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
            {filteredGroups.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No commands found.</p>
            )}
            {filteredGroups.map((group) => (
              <div key={group.label} className="mb-4">
                <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                <div className="flex flex-col gap-0.5">
                  {group.commands.map((cmd) => (
                    <button
                      key={cmd.name}
                      type="button"
                      onClick={() => handleCommandClick(cmd)}
                      className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent active:bg-accent"
                    >
                      <span className="mt-px shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
                        {cmd.name}
                      </span>
                      <span className="text-sm leading-snug text-muted-foreground">
                        {cmd.description}
                        {(cmd.name === "/model" || cmd.name === "/models") && backendMode === "openclaw" && (
                          <span className="ml-1 text-primary">→</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
