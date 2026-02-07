// Demo mode — simulates an OpenClaw backend with curated history and keyword-matched responses

interface ContentPart {
  type: string;
  text?: string;
  name?: string;
  arguments?: string;
  status?: "running" | "success" | "error";
  result?: string;
  resultError?: boolean;
  image_url?: { url?: string };
  thinking?: string;
}

interface Message {
  role: string;
  content: ContentPart[] | string | null;
  timestamp?: number;
  id?: string;
  reasoning?: string;
  toolName?: string;
  toolArgs?: string;
  isError?: boolean;
  stopReason?: string;
  isContext?: boolean;
}

// ── Demo conversation history ────────────────────────────────────────────────

const BASE_TS = Date.now() - 30 * 60 * 1000; // 30 minutes ago

export const DEMO_HISTORY: Message[] = [
  {
    role: "system",
    content: [{ type: "text", text: "Welcome to MobileClaw demo mode. Try sending a message!" }],
    timestamp: BASE_TS,
    id: "demo-sys-1",
  },
  {
    role: "user",
    content: [{ type: "text", text: "What can you do?" }],
    timestamp: BASE_TS + 60_000,
    id: "demo-u-1",
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "I'm an AI assistant running on **OpenClaw**. Here's what I can help with:\n\n## Capabilities\n\n- **General Q&A** — ask me anything\n- **Code generation** — write and explain code\n- **Tool use** — I can run commands, read files, search the web\n- **Reasoning** — I can think through complex problems step-by-step\n\n### Supported tools\n\n| Tool | Description |\n|------|-------------|\n| `exec` | Run shell commands |\n| `read` | Read file contents |\n| `web_search` | Search the internet |\n| `sessions_spawn` | Launch sub-agents |\n\n> This is a demo — try asking about `weather`, `code`, or say `think` to see different response types!",
      },
    ],
    timestamp: BASE_TS + 65_000,
    id: "demo-a-1",
  },
  {
    role: "user",
    content: [{ type: "text", text: "Can you check the weather in Tokyo?" }],
    timestamp: BASE_TS + 120_000,
    id: "demo-u-2",
  },
  {
    role: "assistant",
    content: [
      {
        type: "tool_call",
        name: "weather",
        arguments: JSON.stringify({ location: "Tokyo, Japan", units: "metric" }),
        status: "success",
        result: JSON.stringify({
          location: "Tokyo, Japan",
          temperature: "22°C",
          condition: "Partly Cloudy",
          humidity: "65%",
          wind: "12 km/h NE",
          forecast: [
            { day: "Tomorrow", high: "24°C", low: "18°C", condition: "Sunny" },
            { day: "Wednesday", high: "21°C", low: "16°C", condition: "Rain" },
          ],
        }, null, 2),
      },
      {
        type: "text",
        text: "Here's the current weather in **Tokyo, Japan**:\n\n- **Temperature:** 22°C (Partly Cloudy)\n- **Humidity:** 65%\n- **Wind:** 12 km/h NE\n\n**Forecast:**\n1. Tomorrow — Sunny, 24°C / 18°C\n2. Wednesday — Rain, 21°C / 16°C",
      },
    ],
    timestamp: BASE_TS + 125_000,
    id: "demo-a-2",
  },
  {
    role: "user",
    content: [{ type: "text", text: "Write me a fibonacci function in Python" }],
    timestamp: BASE_TS + 180_000,
    id: "demo-u-3",
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Here's an efficient Fibonacci implementation using memoization:\n\n```python\nfrom functools import lru_cache\n\n@lru_cache(maxsize=None)\ndef fibonacci(n: int) -> int:\n    \"\"\"Return the nth Fibonacci number.\"\"\"\n    if n < 2:\n        return n\n    return fibonacci(n - 1) + fibonacci(n - 2)\n\n# Usage\nfor i in range(10):\n    print(f\"F({i}) = {fibonacci(i)}\")\n```\n\nThis runs in **O(n)** time thanks to `lru_cache`. Without memoization it would be exponential O(2^n).\n\nYou can also do it iteratively:\n\n```python\ndef fibonacci_iter(n: int) -> int:\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n```\n\nBoth produce the same results: `0, 1, 1, 2, 3, 5, 8, 13, 21, 34, ...`",
      },
    ],
    timestamp: BASE_TS + 185_000,
    id: "demo-a-3",
    reasoning: "The user wants a Fibonacci function. I should provide both recursive (with memoization for efficiency) and iterative approaches. The recursive version with `lru_cache` is elegant and Pythonic, while the iterative version is more memory-efficient. I'll explain the time complexity difference.",
  },
  {
    role: "user",
    content: [{ type: "text", text: "Check what's in my home directory" }],
    timestamp: BASE_TS + 240_000,
    id: "demo-u-4",
  },
  {
    role: "assistant",
    content: [
      {
        type: "tool_call",
        name: "exec",
        arguments: JSON.stringify({ command: "ls -la ~/" }),
        status: "success",
        result: "total 48\ndrwxr-x--- 12 user staff 384 Feb  7 10:30 .\ndrwxr-xr-x  5 root admin 160 Jan 15 09:00 ..\n-rw-r--r--  1 user staff  312 Feb  5 14:22 .bashrc\ndrwx------  3 user staff   96 Jan 20 11:00 .ssh\ndrwxr-xr-x  8 user staff  256 Feb  7 09:15 Documents\ndrwxr-xr-x  5 user staff  160 Feb  6 16:30 Downloads\ndrwxr-xr-x 14 user staff  448 Feb  7 10:30 projects",
      },
      {
        type: "text",
        text: "Your home directory contains the usual suspects — `Documents`, `Downloads`, `projects`, plus config files like `.bashrc` and `.ssh`.",
      },
    ],
    timestamp: BASE_TS + 245_000,
    id: "demo-a-4",
  },
];

// ── Demo response sets ───────────────────────────────────────────────────────

interface DemoResponse {
  thinking?: string;
  toolCalls?: {
    name: string;
    args: Record<string, unknown>;
    result: string;
    isError?: boolean;
    delayMs?: number;
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
    thinking: "This is a complex task that requires multiple steps. I should:\n1. First check the project structure\n2. Read the relevant config file\n3. Make the necessary changes\n\nLet me work through this systematically.",
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
        result: "Sub-agent completed. Found 2 issues:\n1. JWT secret is hardcoded (should use env var)\n2. Token expiry set to 30 days (recommend 24h for web sessions)",
        delayMs: 2500,
      },
    ],
    text: "I've analyzed the project configuration. Here's a summary:\n\n### Project Structure\n\n```\nsrc/config/\n├── app.config.ts      ← main app settings\n├── auth.config.ts     ← ⚠️ 2 security issues\n└── database.config.ts\n```\n\n### Issues Found\n\nThe sub-agent reviewed `auth.config.ts` and found:\n\n1. **JWT secret is hardcoded** — should use `process.env.JWT_SECRET`\n2. **Token expiry too long** — 30 days is risky for web sessions, recommend 24 hours\n\n### Recommendation\n\nBoth are quick fixes. Want me to apply them?",
  },
  help: {
    text: "## Demo Mode Commands\n\nTry these keywords to see different UI features:\n\n| Keyword | What it shows |\n|---------|---------------|\n| **weather** | Thinking + tool call + formatted result |\n| **code** / **function** | Thinking + file read + code blocks |\n| **think** / **reason** | Extended reasoning + markdown |\n| **error** / **fail** | Chained tool calls that error |\n| **research** / **search** | Multi-step web search + reading |\n| **agent** / **project** | Full agent workflow: exec + read + sub-agent |\n| **help** | This list |\n\nYou can also try the **command palette** — tap the `/>` button to browse available OpenClaw slash commands.\n\n### About MobileClaw\n\nThis is a mobile-first chat UI for [OpenClaw](https://github.com/wende/mobileclaw). To connect to a real server, tap the claw icon in the header and enter your server URL.",
  },
};

const DEFAULT_RESPONSE: DemoResponse = {
  thinking: "The user sent a message that doesn't match any specific demo trigger. I'll let them know they're in demo mode and suggest what they can try.",
  text: "I'm running in **demo mode** — no backend server is connected.\n\nI can show off the UI features though! Try:\n- `weather` — thinking + tool call + formatted result\n- `code` — file reading + code blocks\n- `research` — multi-step web search workflow\n- `agent` — full workflow with exec, read, and sub-agent\n- `think` — extended reasoning block\n- `error` — chained tool failures\n- `help` — full command list",
};

// ── Match keywords ───────────────────────────────────────────────────────────

function matchResponse(input: string): DemoResponse {
  const lower = input.toLowerCase();
  if (lower.includes("weather") || lower.includes("forecast") || lower.includes("temperature"))
    return RESPONSES.weather;
  if (lower.includes("code") || lower.includes("function") || lower.includes("program") || lower.includes("script"))
    return RESPONSES.code;
  if (lower.includes("think") || lower.includes("reason") || lower.includes("logic") || lower.includes("puzzle"))
    return RESPONSES.think;
  if (lower.includes("error") || lower.includes("fail") || lower.includes("break"))
    return RESPONSES.error;
  if (lower.includes("research") || lower.includes("search") || lower.includes("look up") || lower.includes("find out"))
    return RESPONSES.research;
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
  onToolStart: (runId: string, name: string, args: string) => void;
  onToolEnd: (runId: string, name: string, result: string, isError: boolean) => void;
  onStreamEnd: (runId: string) => void;
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
        timers.push(setTimeout(() => callbacks.onToolStart(runId, tc.name, argsStr), delay));
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
