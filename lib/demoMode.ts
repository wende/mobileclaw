// Demo mode — simulates an OpenClaw backend with curated history and keyword-matched responses

import type { ContentPart, Message } from "@/types/chat";

// ── Demo conversation history ────────────────────────────────────────────────
// Single message exchange that showcases ALL display features

const BASE_TS = Date.now() - 5 * 60 * 1000; // 5 minutes ago

export const DEMO_HISTORY: Message[] = [
  {
    role: "system",
    content: [{ type: "text", text: "Model changed to **claude-sonnet-4-5**" }],
    timestamp: BASE_TS,
    id: "demo-sys-1",
  },
  {
    role: "user",
    content: [{ type: "text", text: "Show me what MobileClaw can do!" }],
    timestamp: BASE_TS + 1_000,
    id: "demo-u-1",
  },
  {
    role: "assistant",
    content: [
      // Thinking content part
      {
        type: "thinking",
        text: "The user wants to see all UI features. Let me demonstrate:\n\n1. This thinking block shows the reasoning/chain-of-thought display\n2. I'll run some tool calls — both successful and failed ones\n3. Then finish with rich markdown: headers, code blocks, tables, lists, links\n\nThis covers every visual element in the chat interface.",
      },
      // Successful tool call
      {
        type: "tool_call",
        name: "web_search",
        arguments: JSON.stringify({ query: "MobileClaw chat UI features" }),
        status: "success",
        result: JSON.stringify({
          results: [
            { title: "MobileClaw — Mobile-First Chat UI", url: "https://github.com/user/mobileclaw", snippet: "Real-time streaming, tool execution, and reasoning display." },
          ],
        }, null, 2),
      },
      // Failed tool call (to show error state)
      {
        type: "tool_call",
        name: "exec",
        arguments: JSON.stringify({ command: "cat /etc/shadow" }),
        status: "error",
        result: "Permission denied — /etc/shadow is readable only by root",
        resultError: true,
      },
      // Running tool call (to show pending state)
      {
        type: "tool_call",
        name: "sessions_spawn",
        toolCallId: "demo-history-spawn",
        arguments: JSON.stringify({ model: "claude-sonnet-4-5", task: "Analyze codebase structure" }),
        status: "running",
      },
      // Simplified text
      {
        type: "text",
        text: `## Demo Response

\`\`\`typescript
console.log("Hello from MobileClaw!");
\`\`\`

You're absolutely right!`,
      },
    ],
    timestamp: BASE_TS + 5_000,
    id: "demo-a-1",
    thinkingDuration: 3.2,
  },
];

// ── Demo response sets ───────────────────────────────────────────────────────

interface SubagentActivity {
  events: { stream: string; data: Record<string, unknown>; delayMs: number }[];
}

interface DemoResponse {
  thinking?: string;
  toolCalls?: {
    name: string;
    args: Record<string, unknown>;
    result: string;
    isError?: boolean;
    delayMs?: number;
    toolCallId?: string;
    subagentActivity?: SubagentActivity;
  }[];
  text: string;
}

const RESPONSES: Record<string, DemoResponse> = {
  weather: {
    thinking: "The user is asking about weather. I'll use the weather tool to get current conditions, then summarize the results in a readable format with the forecast.",
    toolCalls: [
      {
        name: "weather",
        args: { location: "San Francisco, CA", units: "imperial" },
        result: JSON.stringify({
          location: "San Francisco, CA",
          temperature: "64°F",
          condition: "Foggy",
          humidity: "82%",
          wind: "15 mph W",
          forecast: [
            { day: "Tomorrow", high: "68°F", low: "55°F", condition: "Partly Cloudy" },
            { day: "Wednesday", high: "71°F", low: "58°F", condition: "Sunny" },
            { day: "Thursday", high: "63°F", low: "52°F", condition: "Rain" },
          ],
        }, null, 2),
        delayMs: 1500,
      },
    ],
    text: "Here's the current weather in **San Francisco, CA**:\n\n- **Temperature:** 64°F — Foggy\n- **Humidity:** 82%\n- **Wind:** 15 mph from the west\n\n**3-day forecast:**\n\n| Day | High | Low | Condition |\n|-----|------|-----|-----------|\n| Tomorrow | 68°F | 55°F | Partly Cloudy |\n| Wednesday | 71°F | 58°F | Sunny |\n| Thursday | 63°F | 52°F | Rain |\n\nTypical Karl the Fog morning — should clear up by midweek!",
  },
  code: {
    thinking: "The user wants to see code. I'll write a practical utility function with good TypeScript types, then explain how it works. Let me also read an example file to show how it might be used in context.",
    toolCalls: [
      {
        name: "read",
        args: { file_path: "/projects/app/src/hooks/useSearch.ts" },
        result: "import { useState, useCallback } from 'react';\nimport { debounce } from '../utils/debounce';\n\nexport function useSearch(onSearch: (q: string) => void) {\n  const [query, setQuery] = useState('');\n  const debouncedSearch = useCallback(debounce(onSearch, 300), []);\n  return { query, setQuery: (q: string) => { setQuery(q); debouncedSearch(q); } };\n}",
        delayMs: 600,
      },
    ],
    text: "I found the existing usage. Here's the `debounce` utility it depends on:\n\n```typescript\nfunction debounce<T extends (...args: unknown[]) => void>(\n  fn: T,\n  delayMs: number\n): (...args: Parameters<T>) => void {\n  let timer: ReturnType<typeof setTimeout>;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), delayMs);\n  };\n}\n```\n\nIt's used in `useSearch.ts` to avoid firing API calls on every keystroke — only triggers after the user stops typing for 300ms.\n\n> **Tip:** For React, wrap with `useCallback` so the debounced instance is stable across renders.",
  },
  think: {
    thinking: "Let me think through this step by step.\n\nThe user wants to see the thinking/reasoning feature. I should demonstrate it by working through an interesting problem — something that shows the value of step-by-step reasoning.\n\nLet me pick a classic logic puzzle: if you have 8 balls, one is heavier, and you have a balance scale, what's the minimum number of weighings to find the heavy ball?\n\n**Approach:** Split into groups of 3. Weigh 3 vs 3.\n- If balanced: heavy ball is in the remaining 2 → one more weighing → total 2\n- If unbalanced: take the heavier group of 3, weigh 1 vs 1 → either find it or it's the third → total 2\n\nSo the answer is **2 weighings**. This is a nice example because it demonstrates divide-and-conquer reasoning.",
    text: "Here's a fun logic puzzle I solved:\n\n## The 8 Balls Problem\n\n**Given:** 8 identical-looking balls, one is heavier. You have a balance scale.\n\n**Question:** What's the minimum number of weighings to find the heavy ball?\n\n**Answer: 2 weighings** — here's why:\n\n1. **Divide into groups:** 3 | 3 | 2\n2. **Weigh the two groups of 3:**\n   - If balanced → heavy ball is in the group of 2 → weigh them → **done in 2**\n   - If unbalanced → take the heavier group of 3 → weigh 1 vs 1 → if balanced, it's the third → **done in 2**\n\nThis is the same principle behind *ternary search* — dividing by 3 is optimal for balance problems!",
  },
  error: {
    thinking: "The user wants to see an error state. I'll attempt a command that will fail, then try a fallback approach that also errors — this shows how tool errors render in the UI.",
    toolCalls: [
      {
        name: "exec",
        args: { command: "cat /etc/shadow" },
        result: "Error: Permission denied — /etc/shadow is readable only by root",
        isError: true,
        delayMs: 800,
      },
      {
        name: "exec",
        args: { command: "sudo cat /etc/shadow" },
        result: "Error: sudo requires a TTY. This session does not have interactive terminal access.",
        isError: true,
        delayMs: 1000,
      },
    ],
    text: "Both attempts failed — the first due to **file permissions**, the second because `sudo` requires an interactive terminal.\n\nThis is expected behavior. In a real OpenClaw session, sensitive operations go through the **approval system** — an operator can `/approve` or deny exec requests.\n\n> Use `/approve` to manage execution permissions for your agent.",
  },
  research: {
    thinking: "The user is asking me to research something. I'll need to:\n1. Search the web for current information\n2. Read a relevant source for details\n3. Synthesize the findings into a clear summary\n\nLet me start with a web search, then drill into the most relevant result.",
    toolCalls: [
      {
        name: "web_search",
        args: { query: "OpenClaw AI agent platform features 2026" },
        result: JSON.stringify({
          results: [
            { title: "OpenClaw — Open-Source AI Agent Platform", url: "https://openclaw.dev", snippet: "Multi-model agent orchestration with real-time streaming, tool execution, and cross-platform messaging." },
            { title: "OpenClaw GitHub Repository", url: "https://github.com/openclaw/openclaw", snippet: "Self-hosted AI agent with Telegram, Discord, Slack integration. 2.4k stars." },
          ],
        }, null, 2),
        delayMs: 1800,
      },
      {
        name: "read",
        args: { file_path: "https://openclaw.dev/docs/overview" },
        result: "# OpenClaw Overview\n\nOpenClaw is a self-hosted AI agent platform that connects to multiple LLM providers (OpenAI, Anthropic, Google) and exposes them through a unified chat interface with tool execution capabilities.\n\n## Key Features\n- Multi-model support with automatic fallback\n- Real-time streaming via WebSocket\n- Extensible skill system (AgentSkills)\n- Cross-platform: Telegram, Discord, Slack, Web\n- Sub-agent orchestration",
        delayMs: 1200,
      },
    ],
    text: "Here's what I found:\n\n## OpenClaw — AI Agent Platform\n\nOpenClaw is a **self-hosted** AI agent platform with these key features:\n\n- **Multi-model** — supports OpenAI, Anthropic, Google with automatic fallback\n- **Real-time streaming** — WebSocket-based protocol for live responses\n- **Tool execution** — extensible skill system called *AgentSkills*\n- **Cross-platform** — Telegram, Discord, Slack, and this web UI (MobileClaw)\n- **Sub-agents** — can spawn child agents for parallel work\n\n### Links\n- [Documentation](https://openclaw.dev)\n- [GitHub](https://github.com/openclaw/openclaw) — 2.4k stars\n\n> MobileClaw is the mobile-first web client for OpenClaw's gateway protocol.",
  },
  agent: {
    thinking: "This is a complex task that requires multiple steps. I should:\n1. First check the project structure\n2. Read the relevant config file\n3. Spawn a sub-agent to review security\n\nLet me work through this systematically.",
    toolCalls: [
      {
        name: "exec",
        args: { command: "find ./src -name '*.config.*' -type f" },
        result: "./src/config/database.config.ts\n./src/config/auth.config.ts\n./src/config/app.config.ts",
        delayMs: 700,
      },
      {
        name: "read",
        args: { file_path: "./src/config/app.config.ts" },
        result: "export const appConfig = {\n  name: 'MyApp',\n  version: '2.1.0',\n  api: {\n    baseUrl: process.env.API_URL ?? 'http://localhost:4000',\n    timeout: 30_000,\n    retries: 3,\n  },\n  features: {\n    darkMode: true,\n    notifications: true,\n    analytics: process.env.NODE_ENV === 'production',\n  },\n};",
        delayMs: 500,
      },
      {
        name: "sessions_spawn",
        args: { model: "claude-sonnet-4-5", task: "Review auth.config.ts for security issues" },
        toolCallId: "demo-spawn-agent",
        result: "Sub-agent completed. Found 2 issues:\n1. JWT secret is hardcoded (should use env var)\n2. Token expiry set to 30 days (recommend 24h for web sessions)",
        delayMs: 5500,
        subagentActivity: {
          events: [
            { stream: "lifecycle", data: { phase: "start" }, delayMs: 400 },
            { stream: "reasoning", data: { delta: "Let me review auth.config.ts for security issues. " }, delayMs: 800 },
            { stream: "reasoning", data: { delta: "I'll check for hardcoded secrets, weak token policies, and missing validation." }, delayMs: 1200 },
            { stream: "tool", data: { phase: "start", name: "read", args: { file_path: "src/config/auth.config.ts" } }, delayMs: 1600 },
            { stream: "tool", data: { phase: "result", name: "read", result: "export const authConfig = { ... }" }, delayMs: 2400 },
            { stream: "content", data: { delta: "Found hardcoded JWT secret — " }, delayMs: 2800 },
            { stream: "content", data: { delta: "should use process.env.JWT_SECRET. " }, delayMs: 3200 },
            { stream: "content", data: { delta: "Token expiry is 30 days, too long for web sessions." }, delayMs: 3800 },
            { stream: "tool", data: { phase: "start", name: "exec", args: { command: "grep -n 'secret' auth.config.ts" } }, delayMs: 4200 },
            { stream: "tool", data: { phase: "result", name: "exec", result: "line 7: secret: 'my-jwt-secret'" }, delayMs: 4800 },
            { stream: "lifecycle", data: { phase: "end" }, delayMs: 5200 },
          ],
        },
      },
    ],
    text: "I've analyzed the project configuration. Here's a summary:\n\n### Project Structure\n\n```\nsrc/config/\n├── app.config.ts      ← main app settings\n├── auth.config.ts     ← ⚠️ 2 security issues\n└── database.config.ts\n```\n\n### Issues Found\n\nThe sub-agent reviewed `auth.config.ts` and found:\n\n1. **JWT secret is hardcoded** — should use `process.env.JWT_SECRET`\n2. **Token expiry too long** — 30 days is risky for web sessions, recommend 24 hours\n\n### Recommendation\n\nBoth are quick fixes. Want me to apply them?",
  },
  subagent: {
    thinking: "The user wants to see the sub-agent feature. I'll spawn a sub-agent to do a focused research task so they can see the live activity feed.",
    toolCalls: [
      {
        name: "sessions_spawn",
        args: { model: "claude-sonnet-4-5", task: "Research WebSocket protocol best practices" },
        toolCallId: "demo-spawn-subagent",
        result: "Sub-agent completed successfully.\n\nKey findings:\n- Use binary frames for large payloads\n- Implement heartbeat/ping-pong (30s interval)\n- Always handle reconnection with exponential backoff\n- Use message sequence numbers for ordering",
        delayMs: 8000,
        subagentActivity: {
          events: [
            { stream: "lifecycle", data: { phase: "start" }, delayMs: 300 },
            { stream: "reasoning", data: { delta: "I need to research WebSocket best practices. " }, delayMs: 600 },
            { stream: "reasoning", data: { delta: "Let me search for current recommendations and " }, delayMs: 900 },
            { stream: "reasoning", data: { delta: "check the RFC and popular library patterns." }, delayMs: 1200 },
            { stream: "tool", data: { phase: "start", name: "web_search", args: { query: "WebSocket protocol best practices 2026" } }, delayMs: 1600 },
            { stream: "tool", data: { phase: "result", name: "web_search", result: "Found 5 results" }, delayMs: 2800 },
            { stream: "content", data: { delta: "Based on my research, here are the key findings:\n\n" }, delayMs: 3200 },
            { stream: "tool", data: { phase: "start", name: "web_fetch", args: { url: "https://websockets.spec.dev/best-practices" } }, delayMs: 3600 },
            { stream: "tool", data: { phase: "result", name: "web_fetch", result: "Article loaded successfully" }, delayMs: 4800 },
            { stream: "content", data: { delta: "1. Use binary frames for payloads over 1KB. " }, delayMs: 5200 },
            { stream: "content", data: { delta: "2. Implement heartbeat ping-pong at 30s intervals. " }, delayMs: 5600 },
            { stream: "tool", data: { phase: "start", name: "read", args: { file_path: "docs/websocket-rfc.md" } }, delayMs: 5900 },
            { stream: "tool", data: { phase: "result", name: "read", result: "RFC 6455 section loaded" }, delayMs: 6500 },
            { stream: "content", data: { delta: "3. Always handle reconnection with exponential backoff. " }, delayMs: 6800 },
            { stream: "content", data: { delta: "4. Use message sequence numbers for ordering." }, delayMs: 7200 },
            { stream: "lifecycle", data: { phase: "end" }, delayMs: 7600 },
          ],
        },
      },
    ],
    text: "The sub-agent completed its research. Here's a summary:\n\n## WebSocket Best Practices\n\n| Practice | Why |\n|----------|-----|\n| Binary frames for large payloads | 30% less overhead vs text |\n| Heartbeat ping-pong (30s) | Detect dead connections |\n| Exponential backoff reconnect | Avoid thundering herd |\n| Message sequence numbers | Handle out-of-order delivery |\n\n> These are the same patterns used by MobileClaw's own WebSocket implementation in `lib/useWebSocket.ts`.",
  },
  edit: {
    thinking: "The user wants me to fix a bug in their authentication middleware. Let me read the file first, then apply the fix with an edit.",
    toolCalls: [
      {
        name: "read",
        args: { file_path: "src/middleware/auth.ts" },
        result: "import { verify } from 'jsonwebtoken';\nimport type { Request, Response, NextFunction } from 'express';\n\nexport function authMiddleware(req: Request, res: Response, next: NextFunction) {\n  const token = req.headers.authorization;\n  if (!token) {\n    return res.status(401).json({ error: 'No token provided' });\n  }\n  try {\n    const decoded = verify(token, process.env.JWT_SECRET!);\n    req.user = decoded;\n    next();\n  } catch {\n    return res.status(401).json({ error: 'Invalid token' });\n  }\n}",
        delayMs: 600,
      },
      {
        name: "edit",
        args: {
          file_path: "src/middleware/auth.ts",
          old_string: "  const token = req.headers.authorization;\n  if (!token) {\n    return res.status(401).json({ error: 'No token provided' });\n  }\n  try {\n    const decoded = verify(token, process.env.JWT_SECRET!);",
          new_string: "  const header = req.headers.authorization;\n  if (!header?.startsWith('Bearer ')) {\n    return res.status(401).json({ error: 'Missing or malformed token' });\n  }\n  const token = header.slice(7);\n  try {\n    const decoded = verify(token, process.env.JWT_SECRET!);",
        },
        result: "File edited successfully.",
        delayMs: 800,
      },
    ],
    text: "Fixed the auth middleware. The issue was that it used the raw `Authorization` header instead of extracting the Bearer token:\n\n- **Before:** `req.headers.authorization` — included the `Bearer ` prefix, so `verify()` always failed\n- **After:** Checks for `Bearer ` prefix, then strips it with `.slice(7)`\n\nThis also improves the error message when the header is missing or malformed.",
  },
  help: {
    text: "## Demo Mode Commands\n\nTry these keywords to see different UI features:\n\n| Keyword | What it shows |\n|---------|---------------|\n| **weather** | Thinking + tool call + formatted result |\n| **code** / **function** | Thinking + file read + code blocks |\n| **edit** / **fix** | File read + inline diff display |\n| **think** / **reason** | Extended reasoning + markdown |\n| **error** / **fail** | Chained tool calls that error |\n| **research** / **search** | Multi-step web search + reading |\n| **agent** / **project** | Full agent workflow: exec + read + sub-agent |\n| **subagent** / **spawn** | Live sub-agent activity feed |\n| **help** | This list |\n\nYou can also try the **command palette** — tap the `/>` button to browse available OpenClaw slash commands.\n\n### About MobileClaw\n\nThis is a mobile-first chat UI for [OpenClaw](https://github.com/wende/mobileclaw). To connect to a real server, tap the claw icon in the header and enter your server URL.",
  },
};

const DEFAULT_RESPONSE: DemoResponse = {
  thinking: "The user sent a message that doesn't match any specific demo trigger. I'll let them know they're in demo mode and suggest what they can try.",
  text: "I'm running in **demo mode** — no backend server is connected.\n\nI can show off the UI features though! Try:\n- `weather` — thinking + tool call + formatted result\n- `code` — file reading + code blocks\n- `edit` — file read + inline diff display\n- `research` — multi-step web search workflow\n- `agent` — full workflow with exec, read, and sub-agent\n- `subagent` — live sub-agent activity feed\n- `think` — extended reasoning block\n- `error` — chained tool failures\n- `help` — full command list",
};

// ── Match keywords ───────────────────────────────────────────────────────────

function matchResponse(input: string): DemoResponse {
  const lower = input.toLowerCase();
  if (lower.includes("weather") || lower.includes("forecast") || lower.includes("temperature"))
    return RESPONSES.weather;
  if (lower.includes("edit") || lower.includes("fix") || lower.includes("patch") || lower.includes("diff"))
    return RESPONSES.edit;
  if (lower.includes("code") || lower.includes("function") || lower.includes("program") || lower.includes("script"))
    return RESPONSES.code;
  if (lower.includes("think") || lower.includes("reason") || lower.includes("logic") || lower.includes("puzzle"))
    return RESPONSES.think;
  if (lower.includes("error") || lower.includes("fail") || lower.includes("break"))
    return RESPONSES.error;
  if (lower.includes("research") || lower.includes("search") || lower.includes("look up") || lower.includes("find out"))
    return RESPONSES.research;
  if (lower.includes("subagent") || lower.includes("sub-agent") || lower.includes("spawn"))
    return RESPONSES.subagent;
  if (lower.includes("agent") || lower.includes("project") || lower.includes("analyze") || lower.includes("review"))
    return RESPONSES.agent;
  if (lower.includes("help") || lower.includes("command") || lower.includes("demo"))
    return RESPONSES.help;
  return DEFAULT_RESPONSE;
}

// ── Demo handler — mimics useWebSocket return shape ──────────────────────────

export interface DemoCallbacks {
  onStreamStart: (runId: string) => void;
  onThinking: (runId: string, text: string) => void;
  onTextDelta: (runId: string, delta: string, fullText: string) => void;
  onToolStart: (runId: string, name: string, args: string, toolCallId?: string) => void;
  onToolEnd: (runId: string, name: string, result: string, isError: boolean) => void;
  onStreamEnd: (runId: string) => void;
  onRegisterSpawn?: (toolCallId: string) => void;
  onSubagentEvent?: (sessionKey: string, stream: string, data: Record<string, unknown>, ts: number) => void;
}

export function createDemoHandler(callbacks: DemoCallbacks) {
  let timers: ReturnType<typeof setTimeout>[] = [];

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function sendMessage(text: string) {
    clearTimers();
    const runId = `demo-run-${Date.now()}`;
    const response = matchResponse(text);
    let delay = 300;

    // Start streaming
    timers.push(setTimeout(() => callbacks.onStreamStart(runId), delay));
    delay += 200;

    // Thinking (if present)
    if (response.thinking) {
      const thinkingWords = response.thinking.split(/(\s+)/);
      let accumulated = "";
      for (let i = 0; i < thinkingWords.length; i++) {
        accumulated += thinkingWords[i];
        const snap = accumulated;
        timers.push(setTimeout(() => callbacks.onThinking(runId, snap), delay));
        if (thinkingWords[i].trim()) delay += 15 + Math.random() * 10;
      }
      delay += 400;
    }

    // Tool calls (if present)
    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        const argsStr = JSON.stringify(tc.args);
        const toolCallId = tc.toolCallId || `demo-tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        // Register spawn before tool start so the link is ready
        if (tc.name === "sessions_spawn" && tc.toolCallId) {
          timers.push(setTimeout(() => callbacks.onRegisterSpawn?.(toolCallId), delay));
        }

        timers.push(setTimeout(() => callbacks.onToolStart(runId, tc.name, argsStr, tc.toolCallId ? toolCallId : undefined), delay));

        // Simulate subagent activity if defined
        if (tc.subagentActivity && callbacks.onSubagentEvent) {
          const sessionKey = `demo-subagent-${toolCallId}`;
          const toolStartDelay = delay;
          for (const evt of tc.subagentActivity.events) {
            const evtDelay = toolStartDelay + evt.delayMs;
            timers.push(setTimeout(() => {
              callbacks.onSubagentEvent!(sessionKey, evt.stream, evt.data, Date.now());
            }, evtDelay));
          }
        }

        delay += tc.delayMs ?? 1000;
        timers.push(setTimeout(() => callbacks.onToolEnd(runId, tc.name, tc.result, !!tc.isError), delay));
        delay += 300;
      }
    }

    // Stream text word-by-word
    const words = response.text.split(/(\s+)/);
    let accumulated = "";
    for (let i = 0; i < words.length; i++) {
      accumulated += words[i];
      const snap = accumulated;
      timers.push(setTimeout(() => callbacks.onTextDelta(runId, words[i], snap), delay));
      // Variable delay: longer for punctuation, shorter for whitespace
      if (!words[i].trim()) continue;
      if (/[.!?]$/.test(words[i])) delay += 80 + Math.random() * 60;
      else if (/[,;:]$/.test(words[i])) delay += 40 + Math.random() * 30;
      else delay += 20 + Math.random() * 25;
    }

    delay += 200;
    timers.push(setTimeout(() => callbacks.onStreamEnd(runId), delay));
  }

  return {
    sendMessage,
    stop: clearTimers,
  };
}
