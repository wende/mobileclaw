"use client";

import React from "react";

import { useState, useRef, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ContentPart {
  type: string;
  text?: string;
  name?: string;
  arguments?: string;
}

interface Message {
  role: string;
  content: ContentPart[] | string | null;
  timestamp?: number;
  id?: string;
  reasoning?: string;
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
}

// ── Dummy session from provided JSON ─────────────────────────────────────────

const INITIAL_MESSAGES: Message[] = [
  {
    role: "user",
    content: [{ type: "text", text: "Hi! Can you help me understand this codebase?" }],
    timestamp: 1707234000000,
    id: "msg-001",
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "Hello! I'd be happy to help you understand the codebase. Let me explore the structure for you." }],
    timestamp: 1707234005000,
    id: "msg-002",
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Let me check the project structure first." },
      { type: "tool_call", name: "list_directory", arguments: '{"path": "."}' },
    ],
    timestamp: 1707234010000,
    id: "msg-003",
  },
  {
    role: "toolResult",
    content: [{ type: "tool_result", name: "list_directory", text: "src/\npackage.json\nREADME.md\ntsconfig.json" }],
    timestamp: 1707234011000,
    id: "msg-004",
    toolName: "list_directory",
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Now let me check the package.json to understand the project better." },
      { type: "tool_call", name: "read_file", arguments: '{"path": "package.json"}' },
    ],
    timestamp: 1707234015000,
    id: "msg-005",
  },
  {
    role: "toolResult",
    content: [{ type: "tool_result", name: "read_file", text: '{"name": "my-project", "version": "1.0.0", "dependencies": {}}' }],
    timestamp: 1707234016000,
    id: "msg-006",
    toolName: "read_file",
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "Based on my analysis, this is a TypeScript project with:\n\n- **Source code** in `src/`\n- Standard Node.js project structure\n- TypeScript configuration\n\nWould you like me to explore any specific part?" }],
    timestamp: 1707234020000,
    id: "msg-007",
    stopReason: "end_turn",
  },
];

const STREAMED_RESPONSES: Record<string, Message[]> = {
  default: [
    {
      role: "assistant",
      content: [{ type: "text", text: "I can help with that! Let me take a look.\n\nHere's what I found:\n\n- The project structure is clean and well-organized\n- There are **5 TypeScript files** totaling around 1,250 lines\n- The architecture follows a modular pattern\n\nWould you like me to dive deeper into any specific file?" }],
      id: "stream-resp",
    },
  ],
  weather: [
    {
      role: "assistant",
      content: [
        { type: "text", text: "I'll check the current weather for you." },
        { type: "tool_call", name: "get_weather", arguments: '{"location": "San Francisco, CA", "units": "celsius"}' },
      ],
      id: "stream-tool",
    },
    {
      role: "toolResult",
      content: [{ type: "tool_result", name: "get_weather", text: "Current weather in San Francisco, CA:\nTemperature: 18\u00b0C\nConditions: Partly cloudy\nHumidity: 65%" }],
      id: "stream-tool-result",
      toolName: "get_weather",
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "The weather in San Francisco is looking nice today:\n\n- **Temperature:** 18\u00b0C\n- **Conditions:** Partly cloudy\n- **Humidity:** 65%\n\nPerfect for a walk!" }],
      id: "stream-weather-final",
    },
  ],
  code: [
    {
      role: "assistant",
      content: [{ type: "text", text: "Here's the refactored version:\n\n```typescript\nfunction calculateTotal(items: Item[]): number {\n  return items.reduce(\n    (sum, item) => sum + item.price * item.quantity,\n    0\n  );\n}\n```\n\nThe key changes:\n1. Used `reduce` for a cleaner functional approach\n2. Inlined the calculation\n3. Added proper TypeScript types" }],
      id: "stream-code",
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTextFromContent(content: ContentPart[] | string | null): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.filter((p) => p.type === "text" && p.text).map((p) => p.text).join("");
}

function getToolCalls(content: ContentPart[] | string | null): ContentPart[] {
  if (!content || typeof content === "string") return [];
  return content.filter((p) => p.type === "tool_call");
}

// ── Streaming cursor ─────────────────────────────────────────────────────────

function StreamingCursor() {
  return <span className="ml-0.5 inline-block h-4 w-[2px] bg-foreground animate-pulse" />;
}

// ── Tool Call Pill ───────────────────────────────────────────────────────────

function ToolCallPill({ name, args }: { name: string; args?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        <span>{name}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && args && (
        <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-secondary p-3 text-xs text-muted-foreground">
          {(() => { try { return JSON.stringify(JSON.parse(args), null, 2); } catch { return args; } })()}
        </pre>
      )}
    </div>
  );
}

// ── Tool Result Block ────────────────────────────────────────────────────────

function ToolResultBlock({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const text = getTextFromContent(message.content);
  const name = message.toolName || "tool";

  return (
    <div className="my-1 ml-10 md:ml-12">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          message.isError
            ? "border-destructive/30 bg-destructive/5 text-destructive-foreground"
            : "border-border bg-secondary text-muted-foreground"
        }`}
      >
        {message.isError ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5" /></svg>
        )}
        <span>{name} {message.isError ? "failed" : "completed"}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && text && (
        <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-secondary p-3 text-xs text-muted-foreground">{text}</pre>
      )}
    </div>
  );
}

// ── Single Message Row ───────────────────────────────────────────────────────

function MessageRow({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
  const text = getTextFromContent(message.content);
  const toolCalls = getToolCalls(message.content);

  if (message.role === "toolResult" || message.role === "tool_result") {
    return <ToolResultBlock message={message} />;
  }

  if (message.role === "system") {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-secondary px-4 py-1 text-xs text-muted-foreground">{text}</span>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
          </svg>
        </div>
      )}
      <div className={`max-w-[85%] md:max-w-[75%] ${isUser ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground" : "flex flex-col gap-1"}`}>
        {message.reasoning && (
          <details className="mb-2 rounded-lg border border-border bg-secondary">
            <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground">Thinking...</summary>
            <p className="px-3 pb-2 text-xs leading-relaxed text-muted-foreground">{message.reasoning}</p>
          </details>
        )}
        {text && (
          <div className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${isUser ? "" : "text-foreground"}`}>
            {text}
            {isStreaming && <StreamingCursor />}
          </div>
        )}
        {toolCalls.map((tc, i) => (
          <ToolCallPill key={`${tc.name}-${i}`} name={tc.name || "tool"} args={tc.arguments} />
        ))}
      </div>
    </div>
  );
}

// ── Commands ─────────────────────────────────────────────────────────────────

interface Command {
  name: string;
  description: string;
  aliases?: string[];
}

interface CommandGroup {
  label: string;
  commands: Command[];
}

const COMMAND_GROUPS: CommandGroup[] = [
  {
    label: "Status",
    commands: [
      { name: "/help", description: "Show available commands." },
      { name: "/commands", description: "List all slash commands." },
      { name: "/status", description: "Show current status." },
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

// ── Command Sheet ────────────────────────────────────────────────────────────

function CommandSheet({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (command: string) => void;
}) {
  const [search, setSearch] = useState("");
  const sheetRef = useRef<HTMLDivElement>(null);
  const bottomOffset = 0; // Declare the variable here

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

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

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-foreground/10 backdrop-blur-sm transition-opacity duration-200 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
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
        className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[70dvh] flex-col rounded-t-2xl border-t border-border bg-background shadow-lg transition-transform duration-300 ease-out ${open ? "translate-y-0" : "pointer-events-none translate-y-full"}`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

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
              placeholder="Search commands..."
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus={open}
            />
          </div>
        </div>

        {/* Command list */}
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
                    onClick={() => {
                      onSelect(cmd.name + " ");
                      onClose();
                    }}
                    className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent active:bg-accent"
                  >
                    <span className="mt-px shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
                      {cmd.name}
                    </span>
                    <span className="text-sm leading-snug text-muted-foreground">
                      {cmd.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Chat Input ───────────────────────────────────────────────────────────────

function ChatInput({
  onSend,
  isStreaming,
  onStop,
  onOpenCommands,
  commandValue,
  onCommandValueUsed,
}: {
  onSend: (text: string) => void;
  isStreaming: boolean;
  onStop: () => void;
  onOpenCommands: () => void;
  commandValue: string | null;
  onCommandValueUsed: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // When a command is selected, fill it in
  useEffect(() => {
    if (commandValue) {
      setValue(commandValue);
      onCommandValueUsed();
      setTimeout(() => ref.current?.focus(), 100);
    }
  }, [commandValue, onCommandValueUsed]);

  const submit = () => {
    const t = value.trim();
    if (!t || isStreaming) return;
    onSend(t);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  };

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(ref.current.scrollHeight, 160) + "px";
    }
  }, [value]);

  return (
    <div className="flex items-end gap-2">
      {/* Commands button */}
      <button
        type="button"
        onClick={onOpenCommands}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Open commands"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 17 6-6-6-6" /><path d="M12 19h8" />
        </svg>
      </button>

      <div className="flex-1 rounded-xl border border-border bg-card px-4 py-3 transition-colors focus-within:border-ring">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Send a message..."
          rows={1}
          className="block w-full resize-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
      {isStreaming ? (
        <button type="button" onClick={onStop} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-primary-foreground transition-colors hover:opacity-80" aria-label="Stop">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
        </button>
      ) : (
        <button type="button" onClick={submit} disabled={!value.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:opacity-80 disabled:opacity-30" aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></svg>
        </button>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const footerRef = useRef<HTMLDivElement>(null); // Declare the variable here

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const stopStreaming = useCallback(() => {
    abortRef.current = true;
    setIsStreaming(false);
    setStreamingId(null);
    for (const t of timeoutsRef.current) clearTimeout(t);
    timeoutsRef.current = [];
  }, []);

  const simulateStream = useCallback((responseMessages: Message[]) => {
    abortRef.current = false;
    setIsStreaming(true);
    let delay = 0;

    for (const msg of responseMessages) {
      const text = getTextFromContent(msg.content);
      const toolCalls = getToolCalls(msg.content);

      if (msg.role === "toolResult" || msg.role === "tool_result") {
        delay += 600;
        const t = setTimeout(() => { if (!abortRef.current) setMessages((prev) => [...prev, msg]); }, delay);
        timeoutsRef.current.push(t);
        delay += 300;
        continue;
      }

      const words = text.split(" ");
      const sid = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      let acc = "";

      const tStart = setTimeout(() => {
        if (abortRef.current) return;
        setStreamingId(sid);
        setMessages((prev) => [...prev, { ...msg, id: sid, content: [{ type: "text", text: "" }] }]);
      }, delay);
      timeoutsRef.current.push(tStart);
      delay += 80;

      for (const word of words) {
        acc += (acc ? " " : "") + word;
        const snap = acc;
        const t = setTimeout(() => {
          if (abortRef.current) return;
          setMessages((prev) => prev.map((m) => (m.id === sid ? { ...m, content: [{ type: "text", text: snap }] } : m)));
        }, delay);
        timeoutsRef.current.push(t);
        delay += 20 + Math.random() * 40;
      }

      delay += 150;
      const tEnd = setTimeout(() => {
        if (abortRef.current) return;
        setStreamingId(null);
        setMessages((prev) => prev.map((m) => (m.id === sid ? { ...msg, id: sid } : m)));
      }, delay);
      timeoutsRef.current.push(tEnd);

      if (toolCalls.length > 0) delay += 400;
      else delay += 200;
    }

    const tFinal = setTimeout(() => { setIsStreaming(false); setStreamingId(null); }, delay);
    timeoutsRef.current.push(tFinal);
  }, []);

  const sendMessage = useCallback((text: string) => {
    const userMsg: Message = { role: "user", content: [{ type: "text", text }], id: `u-${Date.now()}`, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    const lower = text.toLowerCase();
    let key = "default";
    if (lower.includes("weather")) key = "weather";
    else if (lower.includes("code") || lower.includes("refactor") || lower.includes("function")) key = "code";

    setTimeout(() => simulateStream(STREAMED_RESPONSES[key]), 400);
  }, [simulateStream]);

  const handleCommandSelect = useCallback((command: string) => {
    setPendingCommand(command);
  }, []);

  const clearPendingCommand = useCallback(() => {
    setPendingCommand(null);
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Command sheet rendered at root level so backdrop covers entire screen */}
      <CommandSheet
        open={commandsOpen}
        onClose={() => setCommandsOpen(false)}
        onSelect={handleCommandSelect}
      />

      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl md:px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
          </svg>
        </div>
        <div className="flex flex-col">
          <h1 className="text-sm font-semibold text-foreground">OpenClaw</h1>
          <p className="text-[11px] text-muted-foreground">{isStreaming ? "Thinking..." : "Online"}</p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 md:px-6 md:py-4">
          {messages.map((msg, idx) => (
            <MessageRow key={msg.id || idx} message={msg} isStreaming={isStreaming && msg.id === streamingId} />
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="sticky bottom-0 border-t border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-2xl px-4 py-3 md:px-6 md:py-4">
          <ChatInput
            onSend={sendMessage}
            isStreaming={isStreaming}
            onStop={stopStreaming}
            onOpenCommands={() => setCommandsOpen(true)}
            commandValue={pendingCommand}
            onCommandValueUsed={clearPendingCommand}
          />
          <p className="mt-2 text-center text-[10px] text-muted-foreground/50">OpenClaw may produce inaccurate information.</p>
        </div>
      </footer>
    </div>
  );
}
