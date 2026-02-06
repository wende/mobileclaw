"use client";

import React from "react";

import { useState, useRef, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ContentPart {
  type: string;
  text?: string;
  name?: string;
  arguments?: string;
  status?: "running" | "success" | "error";
  source?: Record<string, unknown>;
  image_url?: { url?: string };
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
    role: "system",
    content: [{ type: "text", text: "Showing last 200 messages (50 hidden)." }],
    timestamp: 1707234559000,
    id: "msg-system-001",
  },
  {
    role: "user",
    content: [{ type: "text", text: "Find all TypeScript files in the src directory and count the lines of code" }],
    timestamp: 1707234500000,
    id: "msg-user-010",
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "I'll help you find TypeScript files and count lines of code." },
      { type: "tool_call", name: "execute_command", arguments: '{"command": "find src -name \'*.ts\' -type f", "timeout": 30000}' },
    ],
    timestamp: 1707234501000,
    id: "msg-assistant-010",
  },
  {
    role: "toolResult",
    content: [{ type: "tool_result", name: "execute_command", text: "src/index.ts\nsrc/utils/helpers.ts\nsrc/components/Button.ts\nsrc/components/Modal.ts\nsrc/services/api.ts" }],
    timestamp: 1707234502000,
    id: "msg-tool-010",
    toolName: "execute_command",
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Found 5 TypeScript files. Now let me count the lines of code." },
      { type: "tool_call", name: "execute_command", arguments: '{"command": "find src -name \'*.ts\' -type f -exec wc -l {} + | tail -1", "timeout": 30000}' },
    ],
    timestamp: 1707234503000,
    id: "msg-assistant-011",
  },
  {
    role: "toolResult",
    content: [{ type: "tool_result", name: "execute_command", text: "  1250 total" }],
    timestamp: 1707234504000,
    id: "msg-tool-011",
    toolName: "execute_command",
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "**Results:**\n\nFound **5 TypeScript files** in the `src` directory with a total of **1,250 lines of code**.\n\n| File | Lines |\n|------|-------|\n| src/index.ts | ~50 |\n| src/utils/helpers.ts | ~200 |\n| src/components/Button.ts | ~300 |\n| src/components/Modal.ts | ~400 |\n| src/services/api.ts | ~300 |" }],
    timestamp: 1707234505000,
    id: "msg-assistant-012",
    stopReason: "end_turn",
  },
];

const STREAMED_RESPONSES: Record<string, Message[]> = {
  default: [
    {
      role: "assistant",
      content: [{ type: "text", text: "# Analysis Complete\n\nHere's what I found:\n\n- The project structure is clean and well-organized\n- There are **5 TypeScript files** totaling around 1,250 lines\n- The architecture follows a modular pattern\n\n> The codebase is in good shape overall.\n\nWould you like me to dive deeper into any specific file?" }],
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
      content: [{ type: "text", text: "The weather in San Francisco is looking nice today:\n\n| Metric | Value |\n|--------|-------|\n| Temperature | 18\u00b0C |\n| Conditions | Partly cloudy |\n| Humidity | 65% |\n\nPerfect for a walk!" }],
      id: "stream-weather-final",
    },
  ],
  code: [
    {
      role: "assistant",
      content: [
        { type: "text", text: "Let me read the file first." },
        { type: "tool_call", name: "read_file", arguments: '{"path": "src/utils/helpers.ts"}' },
      ],
      id: "stream-code-tool",
    },
    {
      role: "toolResult",
      content: [{ type: "tool_result", name: "read_file", text: "function calculateTotal(items) {\n  let total = 0;\n  for (const item of items) {\n    total += item.price * item.quantity;\n  }\n  return total;\n}" }],
      id: "stream-code-result",
      toolName: "read_file",
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "Here's the refactored version:\n\n```typescript\nfunction calculateTotal(items: Item[]): number {\n  return items.reduce(\n    (sum, item) => sum + item.price * item.quantity,\n    0\n  );\n}\n```\n\nThe key changes:\n1. Used `reduce` for a cleaner functional approach\n2. Inlined the calculation\n3. Added proper TypeScript types\n\n> This is more idiomatic TypeScript and easier to test." }],
      id: "stream-code",
    },
  ],
  error: [
    {
      role: "assistant",
      content: [
        { type: "text", text: "Let me try running that command." },
        { type: "tool_call", name: "execute_command", arguments: '{"command": "cat /path/to/file.txt"}' },
      ],
      id: "stream-error-tool",
    },
    {
      role: "toolResult",
      content: [{ type: "tool_result", name: "execute_command", text: "Error: Command failed with exit code 1\nstderr: File not found: /path/to/file.txt" }],
      id: "stream-error-result",
      toolName: "execute_command",
      isError: true,
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "The file wasn't found at that path. Could you double-check the file location? You can use:\n\n```bash\nfind . -name \"file.txt\" -type f\n```\n\nto search for it." }],
      id: "stream-error-final",
    },
  ],
  markdown: [
    {
      role: "assistant",
      content: [{ type: "text", text: "# Heading 1\n\n## Heading 2\n\n**Bold text** and *italic text*\n\n```typescript\nconst x: number = 42;\nconsole.log(x);\n```\n\n- List item 1\n- List item 2\n  - Nested item\n\n> Blockquote\n\n[Link](https://example.com)\n\n| Table | Header |\n|-------|--------|\n| Cell1 | Cell2  |" }],
      id: "stream-md",
    },
  ],
  thinking: [
    {
      role: "assistant",
      content: [{ type: "text", text: "The answer is **42**.\n\nThis comes from Douglas Adams' *The Hitchhiker's Guide to the Galaxy*, where the supercomputer Deep Thought computed the \"Answer to the Ultimate Question of Life, the Universe, and Everything\" over 7.5 million years." }],
      id: "stream-think",
      reasoning: "Let me work through this step by step. First, I need to understand what the question is asking. The user seems to be referencing a famous philosophical question...",
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

function getImages(content: ContentPart[] | string | null): ContentPart[] {
  if (!content || typeof content === "string") return [];
  return content.filter((p) => p.type === "image" || p.type === "image_url");
}

// ── Streaming cursor ─────────────────────────────────────────────────────────

function StreamingCursor() {
  return <span className="ml-0.5 inline-block h-4 w-[2px] bg-foreground animate-pulse" />;
}

// ── Markdown Renderer ────────────────────────────────────────────────────────

function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="group relative my-3 rounded-lg border border-border bg-secondary">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{lang || "text"}</span>
        <button type="button" onClick={copy} className="text-[11px] text-muted-foreground transition-colors hover:text-foreground">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}

function MarkdownContent({ text }: { text: string }) {
  // Split text by code blocks first
  const segments = text.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {segments.map((segment, i) => {
        // Fenced code block
        if (segment.startsWith("```") && segment.endsWith("```")) {
          const inner = segment.slice(3, -3);
          const newlineIdx = inner.indexOf("\n");
          const lang = newlineIdx > -1 ? inner.slice(0, newlineIdx).trim() : "";
          const code = newlineIdx > -1 ? inner.slice(newlineIdx + 1) : inner;
          return <CodeBlock key={i} lang={lang} code={code} />;
        }

        // Inline markdown
        return <InlineMarkdown key={i} text={segment} />;
      })}
    </>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={`br-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // Headings
    if (line.startsWith("# ")) {
      elements.push(<h1 key={`h1-${i}`} className="text-lg font-bold text-foreground mt-4 mb-1">{renderInline(line.slice(2))}</h1>);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<h2 key={`h2-${i}`} className="text-base font-semibold text-foreground mt-3 mb-1">{renderInline(line.slice(3))}</h2>);
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(<h3 key={`h3-${i}`} className="text-sm font-semibold text-foreground mt-2 mb-1">{renderInline(line.slice(4))}</h3>);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={`bq-${i}`} className="my-2 border-l-2 border-border pl-3 text-muted-foreground italic">
          {renderInline(quoteLines.join("\n"))}
        </blockquote>
      );
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].match(/^\|?[\s-:|]+\|/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<MarkdownTable key={`tbl-${i}`} lines={tableLines} />);
      continue;
    }

    // Unordered list
    if (line.match(/^(\s*)[-*]\s/)) {
      const listItems: { depth: number; text: string }[] = [];
      while (i < lines.length && lines[i].match(/^(\s*)[-*]\s/)) {
        const match = lines[i].match(/^(\s*)[-*]\s(.*)/);
        if (match) listItems.push({ depth: match[1].length, text: match[2] });
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-1.5 flex flex-col gap-0.5">
          {listItems.map((item, j) => (
            <li key={j} className="flex gap-1.5 text-foreground" style={{ paddingLeft: `${item.depth * 8 + 4}px` }}>
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
              <span>{renderInline(item.text)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        const match = lines[i].match(/^\d+\.\s(.*)/);
        if (match) listItems.push(match[1]);
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-1.5 flex flex-col gap-0.5">
          {listItems.map((item, j) => (
            <li key={j} className="flex gap-1.5 pl-1 text-foreground">
              <span className="shrink-0 text-muted-foreground">{j + 1}.</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph
    elements.push(<p key={`p-${i}`} className="text-foreground">{renderInline(line)}</p>);
    i++;
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode[] {
  // Process: **bold**, *italic*, `inline code`, [link](url)
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) parts.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>);
    else if (match[3]) parts.push(<em key={match.index}>{match[4]}</em>);
    else if (match[5]) parts.push(<code key={match.index} className="rounded bg-secondary px-1 py-0.5 font-mono text-[13px]">{match[6]}</code>);
    else if (match[7]) parts.push(<a key={match.index} href={match[9]} className="underline underline-offset-2 hover:text-foreground" target="_blank" rel="noopener noreferrer">{match[8]}</a>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const parseRow = (line: string) => line.split("|").map((c) => c.trim()).filter(Boolean);
  const headers = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);

  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-secondary">
            {headers.map((h, i) => <th key={i} className="px-3 py-1.5 text-left font-semibold text-foreground">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {row.map((cell, j) => <td key={j} className="px-3 py-1.5 text-muted-foreground">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tool Call Pill with lifecycle ────────────────────────────────────────────

function ToolCallPill({ name, args, status }: { name: string; args?: string; status?: "running" | "success" | "error" }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent"
      >
        {status === "running" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin opacity-50">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : status === "error" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-destructive">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        )}
        <span>{name}</span>
        {status === "running" && <span className="text-muted-foreground">running...</span>}
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

// ── Image Thumbnails ─────────────────────────────────────────────────────────

function ImageThumbnails({ images }: { images: ContentPart[] }) {
  if (images.length === 0) return null;
  return (
    <div className="mt-1.5 flex gap-1.5 flex-wrap">
      {images.map((img, i) => {
        const src = img.type === "image_url" ? img.image_url?.url : undefined;
        return (
          <div key={i} className="h-16 w-16 overflow-hidden rounded-lg border border-border bg-secondary">
            {src ? (
              <img src={src || "/placeholder.svg"} alt="Attached" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
                  <rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Single Message Row ───────────────────────────────────────────────────────

function MessageRow({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
  const text = getTextFromContent(message.content);
  const toolCalls = getToolCalls(message.content);
  const images = getImages(message.content);

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

  // Unknown roles -- render as muted system-like
  if (message.role !== "user" && message.role !== "assistant") {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-secondary px-4 py-1 text-xs text-muted-foreground">{text || `[${message.role}]`}</span>
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
        {isUser ? (
          <>
            {text && (
              <div className="text-sm leading-relaxed break-words">
                {text}
              </div>
            )}
            <ImageThumbnails images={images} />
          </>
        ) : (
          <>
            {text && (
              <div className="text-sm leading-relaxed break-words text-foreground">
                <MarkdownContent text={text} />
                {isStreaming && <StreamingCursor />}
              </div>
            )}
          </>
        )}
        {toolCalls.map((tc, i) => (
          <ToolCallPill key={`${tc.name}-${i}`} name={tc.name || "tool"} args={tc.arguments} status={tc.status as "running" | "success" | "error" | undefined} />
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

// ── Setup Dialog ─────────────────────────────────────────────────────────────

function SetupDialog({ onConnect, visible }: { onConnect: (url: string) => void; visible: boolean }) {
  const [url, setUrl] = useState("http://127.0.0.1:18789");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "entering" | "open" | "closing" | "closed">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  // Enter animation on mount
  useEffect(() => {
    if (visible && phase === "idle") {
      requestAnimationFrame(() => {
        setPhase("entering");
        requestAnimationFrame(() => setPhase("open"));
      });
    }
  }, [visible, phase]);

  // Focus input once open
  useEffect(() => {
    if (phase === "open") {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [phase]);

  const handleSubmit = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("URL is required");
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setError("Please enter a valid URL");
      return;
    }
    setError("");
    setPhase("closing");
    setTimeout(() => {
      setPhase("closed");
      onConnect(trimmed);
    }, 500);
  };

  if (phase === "closed" || (!visible && phase === "idle")) return null;

  const isOpen = phase === "open";
  const isClosing = phase === "closing";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center transition-all duration-500 ease-out"
      style={{
        backgroundColor: isClosing ? "transparent" : undefined,
        backdropFilter: isOpen ? "blur(8px)" : isClosing ? "blur(0px)" : "blur(0px)",
        opacity: isClosing ? 0 : isOpen ? 1 : 0,
        pointerEvents: isClosing ? "none" : "auto",
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 transition-opacity duration-500"
        style={{ opacity: isOpen ? 1 : 0 }}
      />

      {/* Card */}
      <div
        className="relative mx-4 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg transition-all duration-500 ease-out"
        style={{
          transform: isOpen
            ? "scale(1) translateY(0)"
            : isClosing
              ? "scale(0.8) translateY(-40px)"
              : "scale(0.9) translateY(20px)",
          opacity: isOpen ? 1 : isClosing ? 0 : 0,
        }}
      >
        {/* Icon -- pulses briefly on close */}
        <div className="mb-4 flex justify-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary transition-all duration-300"
            style={{
              transform: isClosing ? "scale(1.2)" : "scale(1)",
              boxShadow: isClosing ? "0 0 20px oklch(0.55 0 0 / 0.15)" : "none",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground">
              <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
            </svg>
          </div>
        </div>

        <h2 className="mb-1 text-center text-lg font-semibold text-foreground">Connect to OpenClaw</h2>
        <p className="mb-5 text-center text-sm text-muted-foreground">
          Enter the URL of your running OpenClaw instance.
        </p>

        {/* URL input */}
        <div className="mb-4">
          <label htmlFor="openclaw-url" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Server URL
          </label>
          <input
            ref={inputRef}
            id="openclaw-url"
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            placeholder="http://127.0.0.1:18789"
            className={`w-full rounded-xl border bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${error ? "border-destructive" : "border-border"}`}
          />
          {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
        </div>

        {/* Connect button */}
        <button
          type="button"
          onClick={handleSubmit}
          className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          Connect
        </button>

        <p className="mt-3 text-center text-[11px] text-muted-foreground/60">
          Currently using mocked responses. Real WebSocket integration coming soon.
        </p>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [openclawUrl, setOpenclawUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  // 0 = at bottom (full input), 1 = scrolled away (collapsed pill)
  const [scrollProgress, setScrollProgress] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Track scroll position as continuous 0-1 progress
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const range = 120; // pixels over which the morph happens
    const progress = Math.min(Math.max(distanceFromBottom / range, 0), 1);
    setScrollProgress(progress);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);



  // Check localStorage on mount for previously saved URL
  useEffect(() => {
    const saved = window.localStorage.getItem("openclaw-url");
    if (saved) setOpenclawUrl(saved);
  }, []);

  const handleConnect = useCallback((url: string) => {
    window.localStorage.setItem("openclaw-url", url);
    setOpenclawUrl(url);
  }, []);


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

      // Start streaming text
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

      // If this message has tool calls, show them with running -> complete lifecycle
      if (toolCalls.length > 0) {
        delay += 100;
        for (const tc of toolCalls) {
          // Show tool call in "running" state
          const tToolStart = setTimeout(() => {
            if (abortRef.current) return;
            setStreamingId(null);
            setMessages((prev) => prev.map((m) =>
              m.id === sid
                ? { ...m, content: [...(Array.isArray(m.content) ? m.content : []), { ...tc, status: "running" }] }
                : m
            ));
          }, delay);
          timeoutsRef.current.push(tToolStart);
          delay += 800;

          // Transition to "success" state
          const tToolEnd = setTimeout(() => {
            if (abortRef.current) return;
            setMessages((prev) => prev.map((m) =>
              m.id === sid
                ? {
                    ...m,
                    content: Array.isArray(m.content)
                      ? m.content.map((c) => c.type === "tool_call" && c.name === tc.name ? { ...c, status: "success" } : c)
                      : m.content,
                  }
                : m
            ));
          }, delay);
          timeoutsRef.current.push(tToolEnd);
          delay += 200;
        }
      }

      delay += 150;
      const tEnd = setTimeout(() => {
        if (abortRef.current) return;
        setStreamingId(null);
        // Final message with full content (tool calls already visible, just finalize text)
        setMessages((prev) => prev.map((m) => (m.id === sid ? { ...msg, id: sid } : m)));
      }, delay);
      timeoutsRef.current.push(tEnd);

      delay += 200;
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
    else if (lower.includes("error") || lower.includes("fail") || lower.includes("bug")) key = "error";
    else if (lower.includes("markdown") || lower.includes("format") || lower.includes("table")) key = "markdown";
    else if (lower.includes("think") || lower.includes("reason") || lower.includes("42")) key = "thinking";

    setTimeout(() => simulateStream(STREAMED_RESPONSES[key]), 400);
  }, [simulateStream]);

  const handleCommandSelect = useCallback((command: string) => {
    setPendingCommand(command);
  }, []);

  const clearPendingCommand = useCallback(() => {
    setPendingCommand(null);
  }, []);

  const showSetup = !openclawUrl;

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Setup dialog overlays on top, chat always renders underneath */}
      <SetupDialog onConnect={handleConnect} visible={showSetup} />

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
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-sm font-semibold text-foreground">OpenClaw</h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {isStreaming ? "Thinking..." : openclawUrl}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { window.localStorage.removeItem("openclaw-url"); setOpenclawUrl(null); }}
          className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Disconnect"
        >
          Disconnect
        </button>
      </header>

      <main ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 pb-28 md:px-6 md:py-4 md:pb-28">
          {messages.map((msg, idx) => (
            <MessageRow key={msg.id || idx} message={msg} isStreaming={isStreaming && msg.id === streamingId} />
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Floating morphing bar -- driven by continuous scrollProgress (0=bottom, 1=scrolled) */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3 md:px-6 md:pb-4">
        <div
          onClick={scrollProgress > 0.5 ? scrollToBottom : undefined}
          role={scrollProgress > 0.5 ? "button" : undefined}
          tabIndex={scrollProgress > 0.5 ? 0 : undefined}
          onKeyDown={scrollProgress > 0.5 ? (e) => { if (e.key === "Enter") scrollToBottom(); } : undefined}
          className="pointer-events-auto relative rounded-2xl border border-border bg-card/90 shadow-lg backdrop-blur-xl"
          style={{
            height: `${56 - 16 * scrollProgress}px`,
            padding: `${8 * (1 - scrollProgress)}px`,
            width: `${100 - 60 * scrollProgress}%`,
            maxWidth: `${672 - 392 * scrollProgress}px`,
            cursor: scrollProgress > 0.5 ? "pointer" : "default",
          }}
        >
          {/* Pill layer */}
          <div
            className="absolute inset-0 flex items-center justify-center gap-2 whitespace-nowrap text-xs font-medium text-muted-foreground"
            style={{ opacity: scrollProgress }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="m7 13 5 5 5-5" /><path d="M12 18V6" />
            </svg>
            <span>Scroll to bottom</span>
          </div>

          {/* Input layer */}
          <div
            className="h-full w-full"
            style={{
              opacity: 1 - scrollProgress,
              pointerEvents: scrollProgress < 0.5 ? "auto" : "none",
            }}
          >
            <ChatInput
              onSend={sendMessage}
              isStreaming={isStreaming}
              onStop={stopStreaming}
              onOpenCommands={() => setCommandsOpen(true)}
              commandValue={pendingCommand}
              onCommandValueUsed={clearPendingCommand}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
