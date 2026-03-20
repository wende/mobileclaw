// Demo mode — simulates an OpenClaw backend with curated history and keyword-matched responses

import type { PluginActionInvocation } from "@mc/lib/plugins/types";
import type { AgentEventPayload, Message, PluginAction, PluginActionStyle, PluginContentPart, PluginState } from "@mc/types/chat";

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
      {
        type: "plugin",
        partId: "demo-history-status",
        pluginType: "status_card",
        state: "settled",
        data: {
          label: "Demo background task",
          status: "succeeded",
          detail: "Indexed demo conversation assets",
          startedAt: BASE_TS + 2_800,
          duration: 1600,
        },
        revision: 1,
      },
      {
        type: "plugin",
        partId: "demo-history-pause",
        pluginType: "pause_card",
        state: "settled",
        data: {
          prompt: "Want me to add an AI-powered summary step to this flow?",
          selectedLabel: "Yes, add it",
          options: [
            {
              id: "yes",
              label: "Yes, add it",
              value: "yes",
              style: "primary",
              action: { id: "demo-yes", label: "Yes, add it", style: "primary", request: { kind: "ws", method: "demo.pause.respond", params: {} } },
            },
            {
              id: "no",
              label: "No thanks",
              value: "no",
              action: { id: "demo-no", label: "No thanks", request: { kind: "ws", method: "demo.pause.respond", params: {} } },
            },
          ],
        },
        revision: 1,
      },
      // Simplified text
      {
        type: "text",
        text: `## Demo Response

\`\`\`typescript
console.log("Hello from MobileClaw!");
\`\`\`

You're absolutely right!

Run **/help** to discover all the features.`,
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

interface DemoToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
  isError?: boolean;
  delayMs?: number;
  toolCallId?: string;
  subagentActivity?: SubagentActivity;
}

interface DemoZenCycle {
  thinking: string;
  text: string;
  toolCall?: DemoToolCall;
}

interface DemoPluginMountStep {
  phase: "mount";
  part: PluginContentPart;
  delayMs?: number;
  index?: number;
}

interface DemoPluginReplaceStep {
  phase: "replace";
  partId: string;
  state: PluginState;
  data: unknown;
  revision?: number;
  delayMs?: number;
}

interface DemoPluginRemoveStep {
  phase: "remove";
  partId: string;
  tombstone?: boolean;
  revision?: number;
  delayMs?: number;
}

type DemoPluginStep = DemoPluginMountStep | DemoPluginReplaceStep | DemoPluginRemoveStep;

interface DemoResponse {
  thinking?: string;
  toolCalls?: DemoToolCall[];
  zenCycles?: DemoZenCycle[];
  pluginSteps?: DemoPluginStep[];
  text: string;
  delayMs?: number; // Extra delay before text starts (e.g. for /compact simulation)
  instant?: boolean; // Deliver text all at once (slash command responses)
}

function buildDemoAction(params: Record<string, unknown>, label: string, style?: PluginActionStyle): PluginAction {
  return {
    id: `${label.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    label,
    style,
    request: {
      kind: "ws",
      method: "demo.pause.respond",
      params,
    },
  };
}

function buildPluginDemoResponse(): DemoResponse {
  const partId = `demo-status-${Date.now()}`;
  const startedAt = Date.now();
  return {
    thinking: "The user wants to see the new plugin widgets. I'll stream a status card into the thread, update it in place, and point them to the interactive pause card next.",
    text: "I started a mock release. Watch the status card update in place as the run progresses.\n\nTry `pause` next to see the interactive pause card.",
    pluginSteps: [
      {
        phase: "mount",
        delayMs: 180,
        part: {
          type: "plugin",
          partId,
          pluginType: "status_card",
          state: "pending",
          data: {
            label: "Preview deployment",
            status: "pending",
            detail: "Reserving build worker",
          },
          revision: 1,
        },
      },
      {
        phase: "replace",
        delayMs: 700,
        partId,
        state: "active",
        data: {
          label: "Preview deployment",
          status: "running",
          detail: "Uploading assets and warming cache",
          startedAt,
        },
        revision: 2,
      },
      {
        phase: "replace",
        delayMs: 1400,
        partId,
        state: "settled",
        data: {
          label: "Preview deployment",
          status: "succeeded",
          detail: "Preview deployment is ready to review",
          startedAt,
          duration: 2800,
        },
        revision: 3,
      },
    ],
  };
}

function buildAttachDemoResponse(): DemoResponse {
  const partId = `demo-context-${Date.now()}`;
  return {
    thinking: "The user wants to see the input attachment plugin. I'll mount a context_chip that lets them attach context to their next message.",
    text: "Here's a context chip — click **Attach** to add it to your compose bar, then send a message with it attached.",
    pluginSteps: [
      {
        phase: "mount",
        delayMs: 180,
        part: {
          type: "plugin",
          partId,
          pluginType: "context_chip",
          state: "settled",
          revision: 1,
          data: {
            label: "Project brief",
            context: "MobileClaw is a mobile-first chat UI for the OpenClaw agent platform, built with Next.js, Tailwind CSS v4, and an extensible plugin system.",
            description: "Attach this as context to your next message",
          },
        },
      },
    ],
  };
}

function buildPauseDemoResponse(): DemoResponse {
  const partId = `demo-pause-${Date.now()}`;
  const expiresAt = Date.now() + 10 * 60 * 1000;
  return {
    thinking: "The user wants to see the interactive plugin. I'll pause for approval, render the pause card inline, and wait for their selection before continuing.",
    text: "I need one confirmation before I continue this mock rollout.",
    pluginSteps: [
      {
        phase: "mount",
        delayMs: 180,
        part: {
          type: "plugin",
          partId,
          pluginType: "pause_card",
          state: "active",
          revision: 1,
          data: {
            prompt: "The rollout is ready. How should I proceed?",
            expiresAt,
            options: [
              {
                id: "continue",
                label: "Continue rollout",
                value: "continue",
                style: "primary",
                action: buildDemoAction({
                  selectedValue: "continue",
                  selectedLabel: "Continue rollout",
                  responseText: "Continuing the rollout and kicking off smoke tests now.",
                }, "Continue rollout", "primary"),
              },
              {
                id: "hold",
                label: "Hold for review",
                value: "hold",
                style: "secondary",
                action: buildDemoAction({
                  selectedValue: "hold",
                  selectedLabel: "Hold for review",
                  responseText: "Holding the rollout. I'll wait for review notes before continuing.",
                }, "Hold for review", "secondary"),
              },
              {
                id: "abort",
                label: "Abort release",
                value: "abort",
                style: "destructive",
                action: buildDemoAction({
                  selectedValue: "abort",
                  selectedLabel: "Abort release",
                  responseText: "Release aborted. I've marked the status as stopped and preserved the current logs for inspection.",
                }, "Abort release", "destructive"),
              },
            ],
          },
        },
      },
    ],
  };
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
  image: {
    thinking: "The user wants to see how images render in markdown. I'll include a few different image examples to show inline markdown image syntax.",
    text: "Here are some example images rendered with markdown:\n\n### A Mountain Landscape\n\n![Mountain landscape](https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80)\n\nImages scale down to fit the chat bubble — they'll never overflow.\n\n### Side by Side\n\nYou can also reference images inline like this: ![tiny icon](https://www.google.com/favicon.ico) — they'll sit right in the text flow.\n\n![Ocean sunset](https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&q=80)\n\n> Markdown syntax: `![alt text](url)`",
  },
  long: {
    thinking: "The user wants a long-form response. I'll write a comprehensive technical deep-dive about building real-time collaborative systems. This will cover WebSocket architecture, conflict resolution, state synchronization, and production scaling patterns. Let me research the topic first, then write the full guide.",
    toolCalls: [
      {
        name: "web_search",
        args: { query: "real-time collaborative systems architecture 2026" },
        result: JSON.stringify({
          results: [
            { title: "Building Real-Time Systems at Scale", url: "https://engineering.example.com/real-time", snippet: "Patterns for WebSocket architecture, CRDT-based conflict resolution, and horizontal scaling." },
            { title: "The State of CRDTs in 2026", url: "https://crdt.tech/survey-2026", snippet: "Survey of conflict-free replicated data types in production systems." },
          ],
        }, null, 2),
        delayMs: 2000,
      },
    ],
    text: `## Building Real-Time Collaborative Systems: A Comprehensive Guide

Real-time collaboration has become the baseline expectation for modern applications. Users expect to see changes from other participants instantly — whether they're editing a document, chatting in a thread, or co-designing an interface. Building these systems well requires understanding several interconnected layers: transport, state synchronization, conflict resolution, and operational scaling. This guide walks through each layer with practical patterns drawn from production systems.

### The Transport Layer: Beyond Simple WebSockets

WebSockets provide the foundation for bidirectional real-time communication, but raw WebSocket connections are just the beginning. A production transport layer needs to handle connection lifecycle management, reconnection with state recovery, multiplexing multiple logical channels over a single connection, and graceful degradation when WebSocket connections fail.

**Connection lifecycle** starts with the initial handshake. Unlike HTTP, a WebSocket upgrade involves a protocol switch that many corporate proxies and load balancers handle poorly. Your client should attempt a WebSocket connection first, then fall back to long-polling or Server-Sent Events if the upgrade fails. Track connection state as a finite state machine: \`disconnected → connecting → authenticating → ready → disconnecting\`. This prevents race conditions where messages arrive before authentication completes.

**Reconnection** is where most implementations stumble. A naive approach reconnects immediately on disconnect, but this causes thundering herd problems when a server restarts — thousands of clients reconnect simultaneously and overwhelm the new instance. Instead, use exponential backoff with jitter: start at 1 second, double up to a cap of 30 seconds, and add random jitter of plus or minus 25 percent to spread reconnection attempts across time.

The critical reconnection challenge is **state recovery**. When a client reconnects, it needs to catch up on events it missed during the disconnection window. The simplest approach is cursor-based recovery: every event has a monotonically increasing sequence number, and the client sends its last-seen sequence on reconnect. The server replays all events since that sequence. This works well for short disconnections but becomes expensive for long gaps. For gaps exceeding your replay buffer, fall back to a full state sync — have the client request a snapshot and reset its local state.

**Multiplexing** lets you run multiple logical channels over one physical connection. Rather than opening separate WebSocket connections for chat, presence, and document updates, tag each message with a channel identifier and route it client-side. This reduces connection overhead and simplifies authentication, since you only need to authenticate once per physical connection.

### State Synchronization: The Heart of Collaboration

State synchronization is the central challenge of real-time systems. Every participant has a local copy of the shared state, and the system must keep these copies converging toward consistency — even when participants make concurrent changes.

The simplest model is **authoritative server**: all mutations go through the server, which applies them sequentially and broadcasts the results. This guarantees consistency but introduces latency on every operation. The user types a character, it round-trips to the server, and only then appears on screen. For applications where latency is acceptable — like chat messages or form submissions — this model works perfectly. MobileClaw uses this approach: messages are sent to the server and rendered only when the server echoes them back (or when streaming events arrive).

For latency-sensitive applications like text editors, you need **optimistic updates** with conflict resolution. The client applies changes locally and immediately, then sends them to the server. If the server accepts the change as-is, everything is fine. If the server reorders or transforms the change, the client needs to reconcile its optimistic state with the server's authoritative version.

**Operational Transformation (OT)** was the first widely-deployed solution to this problem, used by Google Docs since 2010. OT defines transformation functions for every pair of operation types. When two users insert text at different positions concurrently, the transformation function adjusts the positions so both operations produce the correct result regardless of application order. The transformation functions for text editing are well-understood, but OT has a fundamental complexity problem: the number of transformation functions grows quadratically with the number of operation types. Adding a new operation type (say, table formatting) requires defining transforms against every existing operation.

**CRDTs (Conflict-free Replicated Data Types)** solve this differently. Instead of transforming operations, CRDTs design data structures where concurrent operations commute naturally — applying them in any order produces the same result. The Yjs library popularized CRDTs for text editing, and by 2026 they've become the dominant approach for new collaborative editors. CRDTs trade space efficiency for algorithmic simplicity: they attach metadata to every element (character, list item, map entry) that enables automatic conflict resolution. A CRDT document is typically two to five times larger than the raw content, but this overhead is manageable for most applications.

The practical choice between OT and CRDTs depends on your constraints. OT is better when you have a central server and need minimal memory overhead. CRDTs are better for peer-to-peer scenarios or when you want offline editing support, since they can merge divergent states without a central coordinator.

### Presence and Awareness

Beyond document state, collaborative systems need to synchronize **ephemeral presence data**: who is online, where their cursor is, what they're selecting, and whether they're typing. This data is high-frequency and loss-tolerant — if a cursor position update is dropped, the next one will correct it.

Design presence as a separate channel from document operations. Presence updates are frequent (cursor movements generate dozens of events per second) but individually unimportant. Throttle presence broadcasts to a fixed interval — 50 to 100 milliseconds is typical — and always send the latest state rather than queuing individual updates. If the user moved their cursor ten times in 100 milliseconds, only the final position matters.

**Awareness** extends presence with richer metadata: the user's display name, avatar color, viewport scroll position, and current selection. Libraries like Yjs include an awareness protocol that handles this automatically, broadcasting awareness state to all connected peers and cleaning up when users disconnect.

A subtle challenge is **presence timeout**. When a user's browser tab goes to sleep (common on mobile), WebSocket connections may stay open but the user is effectively gone. Implement a heartbeat system: clients send a ping every 30 seconds, and the server marks a user as away if two consecutive pings are missed. Display away users differently in the UI — dimmed avatars, for example — rather than removing them entirely, since they may return when they switch back to the tab.

### Scaling to Production

A single WebSocket server can handle roughly 50,000 to 100,000 concurrent connections on modern hardware, depending on message volume. Beyond that, you need horizontal scaling, which introduces the **fan-out problem**: when User A sends a message, the server handling their connection needs to forward it to all other participants, who may be connected to different servers.

**Redis Pub/Sub** is the most common solution for small to medium scale. Each server subscribes to channels for the rooms it hosts. When a message arrives, the receiving server publishes it to Redis, and all subscribed servers forward it to their local connections. Redis handles roughly 500,000 messages per second on a single instance, which supports millions of concurrent users if message volume per user is moderate.

For larger scale, move to a partitioned message broker like **NATS** or **Kafka**. Partition rooms across broker shards so that each room's messages flow through a single partition, preserving ordering. NATS JetStream provides exactly-once delivery semantics that simplify your application logic — you don't need to deduplicate messages or handle redelivery at the application level.

**Connection routing** determines which server handles each client. The simplest approach is random routing through a load balancer, with Redis Pub/Sub handling fan-out. But this means every message hops through Redis even when sender and receiver are on the same server. For better efficiency, use **sticky routing**: hash the room identifier to a server, and route all participants in that room to the same server. This localizes most fan-out but requires re-routing when servers are added or removed. Consistent hashing minimizes disruption during topology changes.

### Error Handling and Edge Cases

Production real-time systems encounter numerous edge cases that simple prototypes miss. Here are the most important ones to handle.

**Message ordering**: WebSocket guarantees in-order delivery on a single connection, but when messages flow through a broker, ordering can break. Attach monotonic sequence numbers to messages and buffer out-of-order arrivals on the client. If a gap persists for more than two seconds, request a state sync rather than waiting indefinitely.

**Large payloads**: A user pasting an entire log file into a collaborative editor generates a massive operation. Set a maximum message size (typically 1 MB) and split larger operations into chunks. Each chunk references its parent operation and position within the sequence. The receiving end reassembles chunks before applying them.

**Zombie connections**: Sometimes a connection appears alive (no TCP reset) but is actually dead — the network path is broken but neither end has detected it. Server-side heartbeats catch this: if a client doesn't respond to a ping within 10 seconds, terminate the connection. Without this, zombie connections accumulate and waste server resources.

**Split brain**: In partitioned networks, two groups of users might make conflicting changes without seeing each other's updates. When the partition heals, the system must merge divergent states. CRDTs handle this automatically. For OT systems, you need a reconciliation protocol — typically, one side's changes are rebased onto the other side's history, similar to a git rebase.

### Wrapping Up

Building real-time collaborative systems is one of the most challenging areas in application development. The transport layer, state synchronization, presence management, and operational scaling each introduce their own complexities, and they interact in non-obvious ways. Start with the simplest architecture that meets your requirements — authoritative server with WebSocket transport — and add complexity only when you have concrete evidence that you need it. Premature optimization toward CRDTs or custom message brokers wastes engineering time without delivering user-visible improvements.

The most important principle is this: **design for failure**. Networks are unreliable, servers restart, clients go to sleep, and users do unexpected things. A system that handles these gracefully — with automatic reconnection, state recovery, and conflict resolution — will feel magical to users, even if the underlying architecture is straightforward.`,
  },
  zen: {
    text: "Zen demo complete.",
    zenCycles: [
      {
        thinking: "Cycle one. I'll reason briefly, narrate the action, then call a tool so Zen mode can collapse previous blocks.",
        text: "Cycle 1: validating inputs before touching files.",
        toolCall: {
          name: "read",
          args: { file_path: "src/config/app.config.ts" },
          result: "Read 1 file. Found api.timeout=30000 and retries=3.",
          delayMs: 900,
        },
      },
      {
        thinking: "Cycle two. Same pattern again so you can see another think/talk/tool boundary in real time.",
        text: "Cycle 2: running a lightweight check command.",
        toolCall: {
          name: "exec",
          args: { command: "pnpm test --run tests/messageUtils.test.ts" },
          result: "PASS tests/messageUtils.test.ts (21 tests).",
          delayMs: 1100,
        },
      },
      {
        thinking: "Final cycle. I'll think and answer without another tool call so the last block remains visible.",
        text: "Final cycle: done. In Zen mode, previous cycles collapse while this last block stays open.",
      },
    ],
  },
  compact: {
    text: "Conversation compacted. Reduced from **47 messages** (12,840 tokens) to **summary + last 5 messages** (2,160 tokens). Context savings: **83%**.",
    delayMs: 5000,
    instant: true,
  },
  commands: {
    text: "/help · /commands · /status · /model · /compact · /whoami · /context · /queue · /allowlist · /approve · /subagents · /config · /activation · /send · /tts · /restart · /skill · /coding_agent · /research · /weather · /github · /apple_notes · /apple_reminders · /bluebubbles · /clawhub · /gemini · /healthcheck · /nano_banana_pro · /peekaboo · /session_logs · /skill_creator · /tmux · /video_frames · /youtube",
    instant: true,
  },
  status: {
    text: "**Session Status**\n\nModel: claude-sonnet-4-5 (Anthropic)\nSession: demo-abc-1234\nUptime: 2h 15m\nMessages: 12 sent · 8 received\nQueue: empty\nSubagents: 0 active\nMode: demo",
    instant: true,
  },
  whoami: {
    text: "Sender ID: demo-user-42\nDisplay name: Demo User\nAuth: local (demo mode)",
    instant: true,
  },
  context: {
    text: "**Context Configuration**\n\nContext is built from:\n1. System prompt (base instructions)\n2. Conversation history (last 50 messages)\n3. Active tool results\n4. User profile metadata\n\nCurrent token usage: ~2,100 / 200,000 (1%)",
    instant: true,
  },
  model: {
    text: "Current model: **claude-sonnet-4-5** (Anthropic)\n\nAvailable models:\n- claude-sonnet-4-5 (Anthropic) · 200k context\n- claude-opus-4-5 (Anthropic) · 200k context · reasoning\n- gpt-4o (OpenAI) · 128k context\n- gemini-2.5-pro (Google) · 1M context · reasoning",
    instant: true,
  },
  link: {
    thinking: "The user wants to see link previews. I'll share a few URLs so the unfurl cards appear beneath my message after streaming finishes.",
    text: "Here are some interesting links:\n\nhttps://github.com/anthropics/claude-code\n\nhttps://en.wikipedia.org/wiki/WebSocket\n\nThe preview cards should appear after the message finishes streaming. They show the page title, description, and favicon pulled from each site's Open Graph metadata.",
  },
  "scroll-test": {
    thinking: "Processing scroll test request. This thinking block adds initial content height that the auto-scroll must track.",
    text: "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5\n\nLine 6\n\nLine 7\n\nLine 8\n\nLine 9\n\nLine 10\n\nScroll test done. This final line contains enough text to keep the streaming active for a moment so any end-of-stream bounce or scroll jump becomes visible during the grace period.",
  },
  slashDefault: {
    text: "Command not available in demo mode. Try /help to see available commands.",
    instant: true,
  },
  help: {
    text: "## Demo Mode Commands\n\nTry these keywords to see different UI features:\n\n| Keyword | What it shows |\n|---------|---------------|\n| **plugin** / **widget** | Live `status_card` plugin updates |\n| **pause** / **approval** | Interactive `pause_card` plugin |\n| **attach** / **context** | Input attachment plugin (adds context to compose bar) |\n| **weather** | Thinking + tool call + formatted result |\n| **code** / **function** | Thinking + file read + code blocks |\n| **edit** / **fix** | File read + inline diff display |\n| **image** / **picture** | Markdown image rendering |\n| **think** / **reason** | Extended reasoning + markdown |\n| **zen** / **focus** | Multi-cycle think → talk → tool stream for Zen mode |\n| **error** / **fail** | Chained tool calls that error |\n| **research** / **search** | Multi-step web search + reading |\n| **agent** / **project** | Full agent workflow: exec + read + sub-agent |\n| **subagent** / **spawn** | Live sub-agent activity feed |\n| **link** / **url** / **preview** | Link preview unfurl cards |\n| **long** / **essay** | Long-form streaming (~1 minute) |\n| **/compact** | Compacting animation (5s) |\n| **help** | This list |\n\nSlash commands render as expandable pills — try **/commands**, **/status**, **/model**, **/whoami**, or **/context**.\n\nYou can also try the **command palette** — tap the `/>` button to browse available OpenClaw slash commands.\n\n### About MobileClaw\n\nThis is a mobile-first chat UI for [OpenClaw](https://github.com/wende/mobileclaw). To connect to a real server, tap the claw icon in the header and enter your server URL.",
    instant: true,
  },
};

const DEFAULT_RESPONSE: DemoResponse = {
  thinking: "The user sent a message that doesn't match any specific demo trigger. I'll let them know they're in demo mode and suggest what they can try.",
  text: "I'm running in **demo mode** — no backend server is connected.\n\nI can show off the UI features though! Try:\n- `plugin` — live `status_card` plugin updates\n- `pause` — interactive `pause_card` plugin\n- `attach` — input attachment plugin (adds context to compose bar)\n- `weather` — thinking + tool call + formatted result\n- `code` — file reading + code blocks\n- `edit` — file read + inline diff display\n- `image` — markdown image rendering\n- `research` — multi-step web search workflow\n- `agent` — full workflow with exec, read, and sub-agent\n- `subagent` — live sub-agent activity feed\n- `zen` — multi-cycle think/talk/tool stream for Zen mode\n- `link` — link preview unfurl cards\n- `long` — long-form streaming (~1 minute)\n- `think` — extended reasoning block\n- `error` — chained tool failures\n- `/compact` — compacting animation\n- `help` — full command list",
};

// ── Match keywords ───────────────────────────────────────────────────────────

function matchResponse(input: string): DemoResponse {
  const lower = input.toLowerCase().trim();
  // Slash commands — match before keywords
  if (lower.startsWith("/compact")) return RESPONSES.compact;
  if (lower.startsWith("/commands")) return RESPONSES.commands;
  if (lower.startsWith("/status")) return RESPONSES.status;
  if (lower.startsWith("/whoami") || lower.startsWith("/id")) return RESPONSES.whoami;
  if (lower.startsWith("/context")) return RESPONSES.context;
  if (lower.startsWith("/model")) return RESPONSES.model;
  if (lower.startsWith("/help")) return RESPONSES.help;
  if (lower.startsWith("/")) return RESPONSES.slashDefault;
  // Keyword matching
  if (lower.includes("weather") || lower.includes("forecast") || lower.includes("temperature"))
    return RESPONSES.weather;
  if (lower.includes("plugin") || lower.includes("widget"))
    return buildPluginDemoResponse();
  if (lower.includes("attach") || lower.includes("context chip") || lower.includes("context"))
    return buildAttachDemoResponse();
  if (lower.includes("pause") || lower.includes("approval"))
    return buildPauseDemoResponse();
  if (lower.includes("image") || lower.includes("picture") || lower.includes("photo") || lower.includes("img"))
    return RESPONSES.image;
  if (lower.includes("edit") || lower.includes("fix") || lower.includes("patch") || lower.includes("diff"))
    return RESPONSES.edit;
  if (lower.includes("code") || lower.includes("function") || lower.includes("program") || lower.includes("script"))
    return RESPONSES.code;
  if (lower.includes("think") || lower.includes("reason") || lower.includes("logic") || lower.includes("puzzle"))
    return RESPONSES.think;
  if (/\bzen\b/.test(lower) || lower.includes("focus mode") || lower.includes("zen mode"))
    return RESPONSES.zen;
  if (lower.includes("error") || lower.includes("fail") || lower.includes("break"))
    return RESPONSES.error;
  if (lower.includes("research") || lower.includes("search") || lower.includes("look up") || lower.includes("find out"))
    return RESPONSES.research;
  if (lower.includes("link") || lower.includes("url") || lower.includes("preview") || lower.includes("unfurl"))
    return RESPONSES.link;
  if (lower.includes("long") || lower.includes("essay") || lower.includes("minute"))
    return RESPONSES.long;
  if (lower.includes("subagent") || lower.includes("sub-agent") || lower.includes("spawn"))
    return RESPONSES.subagent;
  if (lower.includes("agent") || lower.includes("project") || lower.includes("analyze") || lower.includes("review"))
    return RESPONSES.agent;
  if (lower === "scroll-test") return RESPONSES["scroll-test"];
  if (lower.includes("help") || lower.includes("command") || lower.includes("demo"))
    return RESPONSES.help;
  return DEFAULT_RESPONSE;
}

// ── Demo handler — mimics useWebSocket return shape ──────────────────────────

export interface DemoHandlerOptions {
  onEvent: (event: AgentEventPayload) => void;
  onSubagentEvent?: (sessionKey: string, stream: string, data: Record<string, unknown>, ts: number) => void;
}

export function createDemoHandler(options: DemoHandlerOptions) {
  const { onEvent, onSubagentEvent } = options;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const sessionKey = "demo-session";

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function emit(runId: string, stream: AgentEventPayload["stream"], data: Record<string, unknown>, atDelay: number) {
    timers.push(setTimeout(() => {
      onEvent({ runId, sessionKey, stream, data, seq: 0, ts: Date.now() });
    }, atDelay));
  }

  function emitActionFollowUp(messageId: string, part: PluginContentPart, action: PluginAction, input?: Record<string, unknown>) {
    if (action.request.kind !== "ws" || action.request.method !== "demo.pause.respond") {
      throw new Error("Demo action is not supported.");
    }

    const params = { ...(action.request.params || {}), ...(input || {}) };
    const nextData = typeof part.data === "object" && part.data
      ? { ...(part.data as Record<string, unknown>) }
      : {};
    if (params.selectedValue) nextData.selectedValue = params.selectedValue;
    if (params.selectedLabel) nextData.selectedLabel = params.selectedLabel;

    const nextRevision = typeof part.revision === "number" ? part.revision + 1 : 2;
    emit(messageId, "plugin", {
      phase: "replace",
      partId: part.partId,
      state: "settled",
      data: nextData,
      revision: nextRevision,
    }, 120);

    const followUpRunId = `demo-run-${Date.now()}`;
    let delay = 380;
    emit(followUpRunId, "lifecycle", { phase: "start" }, delay);
    delay += 180;

    const responseText = typeof params.responseText === "string"
      ? params.responseText
      : "Continuing the mock run.";
    const words = responseText.split(/(\s+)/);
    for (const word of words) {
      emit(followUpRunId, "content", { delta: word }, delay);
      if (!word.trim()) continue;
      delay += 24;
    }
    delay += 220;
    emit(followUpRunId, "lifecycle", { phase: "end" }, delay);
  }

  function sendMessage(text: string) {
    clearTimers();
    const runId = `demo-run-${Date.now()}`;
    const response = matchResponse(text);
    let delay = 300;

    const scheduleThinking = (targetRunId: string, thinking?: string) => {
      if (!thinking) return;
      const words = thinking.split(/(\s+)/);
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        emit(targetRunId, "reasoning", { delta: word }, delay);
        if (word.trim()) delay += 15 + Math.random() * 10;
      }
      delay += 400;
    };

    const scheduleToolCall = (targetRunId: string, tc: DemoToolCall) => {
      const toolCallId = tc.toolCallId || `demo-tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      emit(targetRunId, "tool", {
        phase: "start",
        name: tc.name,
        args: tc.args,
        toolCallId: tc.toolCallId ? toolCallId : undefined,
      }, delay);

      if (tc.subagentActivity && onSubagentEvent) {
        const subSessionKey = `demo-subagent-${toolCallId}`;
        const toolStartDelay = delay;
        for (const evt of tc.subagentActivity.events) {
          const evtDelay = toolStartDelay + evt.delayMs;
          timers.push(setTimeout(() => {
            onSubagentEvent(subSessionKey, evt.stream, evt.data, Date.now());
          }, evtDelay));
        }
      }

      delay += tc.delayMs ?? 1000;
      emit(targetRunId, "tool", {
        phase: "result",
        name: tc.name,
        result: tc.result,
        isError: !!tc.isError,
        toolCallId: tc.toolCallId ? toolCallId : undefined,
      }, delay);
      delay += 300;
    };

    const scheduleText = (targetRunId: string, fullText: string, instant = false) => {
      if (instant) {
        emit(targetRunId, "content", { delta: fullText }, delay);
        return;
      }
      const words = fullText.split(/(\s+)/);
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        emit(targetRunId, "content", { delta: word }, delay);
        if (!word.trim()) continue;
        if (/[.!?]$/.test(word)) delay += 80 + Math.random() * 60;
        else if (/[,;:]$/.test(word)) delay += 40 + Math.random() * 30;
        else delay += 20 + Math.random() * 25;
      }
    };

    const schedulePluginStep = (targetRunId: string, step: DemoPluginStep) => {
      delay += step.delayMs ?? 0;
      if (step.phase === "mount") {
        emit(targetRunId, "plugin", {
          phase: "mount",
          part: step.part,
          index: step.index,
        }, delay);
        return;
      }
      if (step.phase === "replace") {
        emit(targetRunId, "plugin", {
          phase: "replace",
          partId: step.partId,
          state: step.state,
          data: step.data,
          revision: step.revision,
        }, delay);
        return;
      }
      emit(targetRunId, "plugin", {
        phase: "remove",
        partId: step.partId,
        tombstone: !!step.tombstone,
        revision: step.revision,
      }, delay);
    };

    if (response.zenCycles && response.zenCycles.length > 0) {
      emit(runId, "lifecycle", { phase: "start" }, delay);
      delay += 180;

      for (let i = 0; i < response.zenCycles.length; i++) {
        const cycle = response.zenCycles[i];
        scheduleThinking(runId, cycle.thinking);
        scheduleText(runId, cycle.text, false);
        if (cycle.toolCall) {
          scheduleToolCall(runId, cycle.toolCall);
        }
        delay += 200;
      }

      delay += 200;
      emit(runId, "lifecycle", { phase: "end" }, delay);
      return;
    }

    emit(runId, "lifecycle", { phase: "start" }, delay);
    delay += 200;
    scheduleThinking(runId, response.thinking);
    if (response.toolCalls) {
      for (const tc of response.toolCalls) scheduleToolCall(runId, tc);
    }
    if (response.pluginSteps) {
      for (const step of response.pluginSteps) schedulePluginStep(runId, step);
    }
    if (response.delayMs) delay += response.delayMs;
    scheduleText(runId, response.text, !!response.instant);
    delay += 200;
    emit(runId, "lifecycle", { phase: "end" }, delay);
  }

  return {
    sendMessage,
    invokePluginAction: async ({ messageId, part, action, input }: PluginActionInvocation) => {
      emitActionFollowUp(messageId, part, action, input);
    },
    stop: clearTimers,
  };
}
