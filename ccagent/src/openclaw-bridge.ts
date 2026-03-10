/**
 * Translates between Claude Code SDK messages and OpenClaw WebSocket protocol.
 * This lets MobileClaw connect to ccagent without any client-side changes.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { WebSocket } from "ws";
import { ClaudeProcess } from "./claude-process.js";
import type { Config } from "./config.js";

const SESSION_KEY = "main";

/** Transform MCP tool names for display: mcp__server__tool_name → Server: Tool Name */
function formatToolName(name: string): string {
  if (!name.startsWith("mcp__")) return name;
  const parts = name.slice(5).split("__"); // Remove "mcp__" prefix, split on "__"
  if (parts.length < 2) return name;
  const server = parts[0];
  const tool = parts.slice(1).join("__");
  const titleCase = (s: string) =>
    s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `${titleCase(server)}: ${titleCase(tool)}`;
}

// Module-level stores — survive WS reconnects
const historyStore: Array<Record<string, unknown>> = [];
let lastSessionId: string | null = null;
// Shared claude process — survives bridge reconnects when no run is in progress
let moduleClaude: ClaudeProcess | null = null;
let moduleActiveRunId: string | null = null;

// Stats tracking — survives WS reconnects
interface RunStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  model: string | null;
  apiCalls: number;
}

function newRunStats(): RunStats {
  return {
    inputTokens: 0, outputTokens: 0,
    cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
    costUsd: 0, durationMs: 0, durationApiMs: 0,
    numTurns: 0, model: null, apiCalls: 0,
  };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Module-level persistent stats — survives WS reconnects, exposed via /stats */
const persistentStats = {
  session: {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationInputTokens: 0,
    totalCacheReadInputTokens: 0,
    totalCostUsd: 0,
    totalDurationMs: 0,
    totalApiCalls: 0,
    totalRuns: 0,
    startedAt: Date.now(),
  },
  runs: [] as Array<RunStats & { completedAt: number; runId: string }>,
};

/** Max recent runs to keep in memory / on disk */
const MAX_RUNS = 50;

export function getStats() {
  return persistentStats;
}

async function persistStatsToDisk(statsPath: string | undefined) {
  if (!statsPath) return;
  try {
    await mkdir(dirname(statsPath), { recursive: true });
    await writeFile(statsPath, JSON.stringify(persistentStats, null, 2));
  } catch (err) {
    console.error(`[stats] Failed to write ${statsPath}:`, (err as Error).message);
  }
}

interface OpenClawMsg {
  type: string;
  [key: string]: unknown;
}

export class OpenClawBridge {
  private ws: WebSocket;
  private claude: ClaudeProcess;
  private model: string | undefined;
  private config: Config;
  private cwd: string | undefined;
  private mcpConfig: string | undefined;
  private seq = 0;
  private activeRunId: string | null = null;
  private accumulatedText = "";
  private reasoningBlocks: string[] = [];
  private textBlocks: string[] = [];
  private currentTextBlockIndex = -1;
  private seenToolIds = new Set<string>();
  private toolCalls = new Map<string, { name: string; toolCallId: string; args?: string; result?: string; isError?: boolean }>();
  private justFinishedAt: number | null = null;
  private responseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Ordered content parts as they arrive: thinking, tool_call, text — interleaved correctly */
  private orderedParts: Array<{ kind: "thinking"; blockIndex: number } | { kind: "tool"; toolCallId: string } | { kind: "text"; blockIndex: number }> = [];
  private runStats: RunStats = newRunStats();
  private sessionStats = {
    totalInputTokens: 0, totalOutputTokens: 0,
    totalCacheCreationInputTokens: 0, totalCacheReadInputTokens: 0,
    totalCostUsd: 0, totalDurationMs: 0, totalApiCalls: 0, totalRuns: 0,
  };

  constructor(ws: WebSocket, opts?: { model?: string; config?: Config; cwd?: string; mcpConfig?: string }) {
    this.ws = ws;
    this.model = opts?.model;
    this.config = opts?.config || {};
    this.cwd = opts?.cwd;
    this.mcpConfig = opts?.mcpConfig;
    // Reuse existing idle process to preserve the debug session and file.
    // If a run is in progress (moduleActiveRunId set), destroy() will have
    // killed it before this constructor runs, so isAlive will be false.
    if (!moduleClaude || !moduleClaude.isAlive) {
      moduleClaude = new ClaudeProcess();
    } else {
      moduleClaude.removeAllListeners();
    }
    this.claude = moduleClaude;
    this.setupClaude();
    this.setupWs();

    // Start the handshake: send connect.challenge
    this.sendEvent("connect.challenge", { nonce: uuidv4(), ts: Date.now() });
  }

  private send(msg: OpenClawMsg) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private sendEvent(event: string, payload: Record<string, unknown>) {
    this.send({
      type: "event",
      event,
      payload,
      seq: ++this.seq,
    });
  }

  private sendRes(id: string, ok: boolean, payload?: unknown, error?: string) {
    const msg: OpenClawMsg = { type: "res", id, ok };
    if (payload !== undefined) msg.payload = payload;
    if (error !== undefined) msg.error = error;
    this.send(msg);
  }

  private setupWs() {
    this.ws.on("message", (data) => {
      let msg: OpenClawMsg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const method = (msg as any).method as string | undefined;
      if (method !== "chat.history") {
        console.log(`[bridge] Client: ${msg.type} ${method || (msg as any).id || ""}`);
      }
      this.handleClientMessage(msg);
    });

    this.ws.on("close", () => {
      console.log("[bridge] WS closed");
    });
  }

  private handleClientMessage(msg: OpenClawMsg) {
    if (msg.type !== "req") return;

    const method = msg.method as string;
    const id = msg.id as string;
    const params = (msg.params || {}) as Record<string, unknown>;

    switch (method) {
      case "connect":
        this.handleConnect(id);
        break;
      case "chat.send":
        this.handleChatSend(id, params);
        break;
      case "chat.abort":
        this.handleChatAbort(id, params);
        break;
      case "chat.history":
        this.handleChatHistory(id);
        break;
      case "sessions.list":
        this.sendRes(id, true, { sessions: [{ key: SESSION_KEY, kind: "main", channel: "cli", displayName: "Claude Code", updatedAt: Date.now() }] });
        break;
      case "models.list":
        this.sendRes(id, true, { models: [] });
        break;
      case "config.get":
        this.sendRes(id, true, { providers: [] });
        break;
      default:
        this.sendRes(id, true, {});
    }
  }

  private handleConnect(id: string) {
    // Only start the process if it isn't already running (e.g. reused from a
    // previous connection that disconnected without an active run).
    if (!this.claude.isAlive) {
      this.claude.start({
        model: this.model,
        cwd: this.cwd,
        mcpConfig: this.mcpConfig,
        systemPrompt: this.config.systemPrompt,
        resumeSessionId: lastSessionId || undefined,
      });
    }

    this.sendRes(id, true, {
      type: "hello-ok",
      server: {
        connId: uuidv4(),
        version: "ccagent-0.1.0",
        name: "ccagent",
      },
      snapshot: {
        sessionDefaults: {
          mainSessionKey: SESSION_KEY,
          mainKey: SESSION_KEY,
        },
      },
    });
  }

  private async handleChatSend(id: string, params: Record<string, unknown>) {
    const text = params.message as string;
    if (!text) {
      this.sendRes(id, false, undefined, "No message text");
      return;
    }

    // Intercept /new — clear history and restart the Claude process
    if (text.trim().toLowerCase() === "/new") {
      historyStore.length = 0;
      lastSessionId = null;
      await this.claude.kill();
      this.claude = new ClaudeProcess();
      this.setupClaude();
      this.claude.start({ model: this.model, cwd: this.cwd, mcpConfig: this.mcpConfig, systemPrompt: this.config.systemPrompt });
      // Send empty final so the client clears streaming state
      this.sendEvent("chat", {
        runId: id,
        sessionKey: SESSION_KEY,
        state: "final",
      });
      this.sendRes(id, true);
      return;
    }

    const runId = id; // Use the request id as runId
    this.activeRunId = runId;
    moduleActiveRunId = runId;
    this.accumulatedText = "";
    this.reasoningBlocks = [];
    this.textBlocks = [];
    this.currentTextBlockIndex = -1;
    this.orderedParts = [];
    this.seenToolIds.clear();
    this.toolCalls.clear();
    this.runStats = newRunStats();

    // Add user message to history
    historyStore.push({
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    });

    // Send a chat delta first to register this as a client-initiated run.
    // This sets activeRunIdRef on the client, so the lifecycle start below
    // is NOT treated as an "external run" — avoiding unwanted history polling
    // that would overwrite the interleaved streaming content.
    this.sendEvent("chat", {
      runId,
      sessionKey: SESSION_KEY,
      state: "delta",
      message: {
        role: "assistant",
        content: [],
        timestamp: Date.now(),
      },
    });

    // Send lifecycle start
    this.sendEvent("agent", {
      runId,
      sessionKey: SESSION_KEY,
      stream: "lifecycle",
      data: { phase: "start" },
      seq: 0,
      ts: Date.now(),
    });

    // Auto-respawn with resume if process died between turns
    if (!this.claude.isAlive) {
      console.log(`[bridge] Claude process died, respawning with resume session=${lastSessionId}`);
      this.claude = new ClaudeProcess();
      this.setupClaude();
      this.claude.start({
        model: this.model,
        cwd: this.cwd,
        mcpConfig: this.mcpConfig,
        systemPrompt: this.config.systemPrompt,
        resumeSessionId: lastSessionId || undefined,
      });
    }

    this.claude.sendPrompt(text);
    this.startResponseTimer(runId);
  }

  private startResponseTimer(runId: string) {
    this.clearResponseTimer();
    this.responseTimer = setTimeout(async () => {
      if (this.activeRunId !== runId) return;
      console.error(`[bridge] No response from Claude within 5s — killing stuck process`);

      this.sendEvent("chat", {
        runId,
        sessionKey: SESSION_KEY,
        state: "error",
        errorMessage: "Something went wrong with CCAgent — no response from Claude. Retrying...",
      });
      this.activeRunId = null;

      await this.claude.kill();
      this.claude = new ClaudeProcess();
      this.setupClaude();
      this.claude.start({
        model: this.model,
        cwd: this.cwd,
        mcpConfig: this.mcpConfig,
        systemPrompt: this.config.systemPrompt,
        resumeSessionId: lastSessionId || undefined,
      });
    }, 5000);
  }

  private clearResponseTimer() {
    if (this.responseTimer) {
      clearTimeout(this.responseTimer);
      this.responseTimer = null;
    }
  }

  private async handleChatAbort(id: string, _params: Record<string, unknown>) {
    const runId = this.activeRunId;
    // Null activeRunId immediately so any Claude messages that arrive while
    // kill() is awaited are dropped by translateSdkMessage.
    this.activeRunId = null;
    moduleActiveRunId = null;
    this.clearResponseTimer();

    // Capture streaming state before kill so we can save partial content.
    const savedText = this.accumulatedText;
    const savedParts = this.orderedParts.slice();
    const savedReasoning = this.reasoningBlocks.slice();
    const savedTextBlocks = this.textBlocks.slice();
    const savedToolCalls = new Map(this.toolCalls);

    // Reset streaming state immediately (before async work).
    this.accumulatedText = "";
    this.reasoningBlocks = [];
    this.textBlocks = [];
    this.currentTextBlockIndex = -1;
    this.orderedParts = [];
    this.seenToolIds.clear();
    this.toolCalls.clear();

    try {
      await this.claude.kill();
    } catch (err) {
      console.error("[bridge] kill error during abort:", (err as Error).message);
    }

    if (runId) {
      // Build partial content from whatever was streamed before the abort.
      const historyParts: Array<Record<string, unknown>> = [];
      try {
        for (const part of savedParts) {
          if (part.kind === "thinking") {
            const text = savedReasoning[part.blockIndex];
            if (text) historyParts.push({ type: "thinking", thinking: text });
          } else if (part.kind === "tool") {
            const tc = savedToolCalls.get(part.toolCallId);
            if (tc) {
              historyParts.push({
                type: "tool_call",
                name: tc.name,
                toolCallId: tc.toolCallId,
                arguments: tc.args,
                status: tc.isError ? "error" : "success",
                result: tc.result,
                resultError: tc.isError,
              });
            }
          } else if (part.kind === "text") {
            const text = savedTextBlocks[part.blockIndex];
            if (text) historyParts.push({ type: "text", text });
          }
        }
        // Fallback: if no text was tracked in orderedParts, use savedText
        if (!savedParts.some(p => p.kind === "text") && savedText) {
          historyParts.push({ type: "text", text: savedText });
        }
      } catch (err) {
        console.error("[bridge] Error building abort history parts:", (err as Error).message);
      }

      // Always push an assistant entry so the history doesn't look like a
      // run-in-progress (isRunInProgressFromHistory returns true for a dangling
      // user message with no assistant response).
      historyStore.push({
        role: "assistant",
        content: historyParts,
        timestamp: Date.now(),
        stopReason: "aborted",
        runId,
      });

      this.sendEvent("chat", {
        runId,
        sessionKey: SESSION_KEY,
        state: "aborted",
      });
    }

    // Respawn for next prompt — resume so context is preserved
    this.claude = new ClaudeProcess();
    moduleClaude = this.claude;
    this.setupClaude();
    this.claude.start({
      model: this.model,
      cwd: this.cwd,
      mcpConfig: this.mcpConfig,
      systemPrompt: this.config.systemPrompt,
      resumeSessionId: lastSessionId || undefined,
    });

    this.sendRes(id, true);
  }

  private handleChatHistory(id: string) {
    // During an active run, historyStore lacks the in-progress assistant message.
    // If the client applies this incomplete history (e.g. on tab-focus sync), the
    // streaming content disappears because mergeHistoryWithOptimistic's length
    // guard can fail when the user message has already landed in historyStore.
    // Tell the client the stream is still live so it defers the update.
    if (this.activeRunId) {
      this.sendRes(id, true, { messages: historyStore, streaming: true });
      return;
    }
    // After a run completes, the client's chat-final handler requests history.
    // buildHistoryMessages on the client strips thinking parts, which would
    // destroy the interleaved thinking/tool structure built during streaming.
    // Silently drop the first history request after a run so the streamed
    // content survives. Subsequent requests (reconnect, refresh) respond normally.
    if (this.justFinishedAt && Date.now() - this.justFinishedAt < 2000) {
      this.justFinishedAt = null; // Only skip once
      return;
    }
    this.sendRes(id, true, { messages: historyStore });
  }

  private setupClaude() {
    this.claude.on("message", (msg: any) => {
      // Debug: log every SDK message type and key fields
      const summary = this.summarizeSdkMessage(msg);
      if (summary) console.log(`[sdk] ${summary}`);
      this.translateSdkMessage(msg);
    });

    this.claude.on("ready", (sessionId: string) => {
      if (sessionId) {
        lastSessionId = sessionId;
        console.log(`[bridge] Stored session for resume: ${sessionId}`);
      }
    });

    this.claude.on("error", (err: Error) => {
      console.error("[bridge] Claude error:", err.message);
      if (this.activeRunId) {
        this.sendEvent("chat", {
          runId: this.activeRunId,
          sessionKey: SESSION_KEY,
          state: "error",
          errorMessage: err.message,
        });
        this.activeRunId = null;
      }
    });

    this.claude.on("exit", (code: number | null) => {
      console.log(`[bridge] Claude exited code=${code} lastSession=${lastSessionId}`);
    });
  }

  /** Send result events for any tracked tools that haven't received a result yet. */
  private resolveUnresolvedTools(runId: string) {
    for (const [toolCallId, tc] of this.toolCalls) {
      if (tc.result !== undefined) continue;
      tc.result = "(completed)";
      this.sendEvent("agent", {
        runId,
        sessionKey: SESSION_KEY,
        stream: "tool",
        data: {
          phase: "result",
          name: tc.name,
          toolCallId,
          result: tc.result,
          isError: false,
        },
        seq: this.seq,
        ts: Date.now(),
      });
    }
  }

  private translateSdkMessage(msg: any) {
    const runId = this.activeRunId;
    if (!runId) return;

    // Got a response — cancel the stuck-process timer
    this.clearResponseTimer();

    switch (msg.type) {
      case "system":
        // Informational only, no OpenClaw equivalent needed
        break;

      case "assistant": {
        // Partial or complete assistant message — extract text and tool_use blocks
        const content = msg.message?.content;
        if (!Array.isArray(content)) break;

        let fullText = "";
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            fullText += block.text;
          }
          // Tool use blocks inside assistant messages
          if (block.type === "tool_use" && block.name) {
            const toolCallId = block.id || `tool-${Date.now()}`;
            if (!this.seenToolIds.has(toolCallId)) {
              this.seenToolIds.add(toolCallId);
              const argsStr = block.input ? JSON.stringify(block.input) : undefined;
              const displayName = formatToolName(block.name);
              this.toolCalls.set(toolCallId, { name: displayName, toolCallId, args: argsStr });
              this.orderedParts.push({ kind: "tool", toolCallId });
              this.sendEvent("agent", {
                runId,
                sessionKey: SESSION_KEY,
                stream: "tool",
                data: {
                  phase: "start",
                  name: displayName,
                  toolCallId,
                  args: block.input,
                },
                seq: this.seq,
                ts: Date.now(),
              });
            }
          }
        }

        // Detect new turn: if the SDK text doesn't extend what we've accumulated,
        // this is a fresh assistant turn (after tool use) — reset tracking.
        if (fullText && this.accumulatedText && !fullText.startsWith(this.accumulatedText)) {
          this.accumulatedText = "";
          this.currentTextBlockIndex = -1;
        }

        // Send incremental text delta
        if (fullText.length > this.accumulatedText.length) {
          const delta = fullText.slice(this.accumulatedText.length);

          // Start a new text block if this is the first text in this turn
          if (this.accumulatedText === "") {
            this.currentTextBlockIndex = this.textBlocks.length;
            this.textBlocks.push(fullText);
            this.orderedParts.push({ kind: "text", blockIndex: this.currentTextBlockIndex });
          } else if (this.currentTextBlockIndex >= 0) {
            this.textBlocks[this.currentTextBlockIndex] = fullText;
          }

          this.accumulatedText = fullText;

          this.sendEvent("agent", {
            runId,
            sessionKey: SESSION_KEY,
            stream: "content",
            data: { delta },
            seq: this.seq,
            ts: Date.now(),
          });
        }
        break;
      }

      case "tool_use": {
        const toolCallId = msg.tool_use_id || `tool-${Date.now()}`;
        // Skip if already reported via an assistant partial message
        if (this.seenToolIds.has(toolCallId)) break;
        this.seenToolIds.add(toolCallId);
        const argsStr = msg.input ? JSON.stringify(msg.input) : undefined;
        const displayName = formatToolName(msg.tool_name);
        this.toolCalls.set(toolCallId, { name: displayName, toolCallId, args: argsStr });
        this.orderedParts.push({ kind: "tool", toolCallId });
        this.sendEvent("agent", {
          runId,
          sessionKey: SESSION_KEY,
          stream: "tool",
          data: {
            phase: "start",
            name: displayName,
            toolCallId,
            args: msg.input,
          },
          seq: this.seq,
          ts: Date.now(),
        });
        break;
      }

      case "tool_result": {
        const toolCallId = msg.tool_use_id || undefined;
        const raw = msg.content ?? msg.result;
        const resultText = typeof raw === "string" ? raw : JSON.stringify(raw);
        // Update tracked tool call with result
        if (toolCallId && this.toolCalls.has(toolCallId)) {
          const tc = this.toolCalls.get(toolCallId)!;
          tc.result = resultText;
          tc.isError = !!msg.is_error;
        }
        this.sendEvent("agent", {
          runId,
          sessionKey: SESSION_KEY,
          stream: "tool",
          data: {
            phase: "result",
            name: (msg.tool_name ? formatToolName(msg.tool_name) : null) || (toolCallId && this.toolCalls.get(toolCallId)?.name) || "unknown",
            toolCallId,
            result: resultText,
            isError: !!msg.is_error,
          },
          seq: this.seq,
          ts: Date.now(),
        });
        break;
      }

      case "result": {
        // Resolve any tools that never got an explicit tool_result message
        this.resolveUnresolvedTools(runId);
        const resultText = typeof msg.result === "string" ? msg.result : this.accumulatedText;

        // Preserve interleaved thinking/tool/text structure so history renders
        // separate blocks between turns, matching the streamed UI.
        const fullReasoning = this.reasoningBlocks.filter(Boolean).join("\n\n");
        const historyParts: Array<Record<string, unknown>> = [];
        for (const part of this.orderedParts) {
          if (part.kind === "thinking") {
            const text = this.reasoningBlocks[part.blockIndex];
            if (text) {
              historyParts.push({ type: "thinking", thinking: text });
            }
          } else if (part.kind === "tool") {
            const tc = this.toolCalls.get(part.toolCallId);
            if (tc) {
              historyParts.push({
                type: "tool_call",
                name: tc.name,
                toolCallId: tc.toolCallId,
                arguments: tc.args,
                status: tc.isError ? "error" : "success",
                result: tc.result,
                resultError: tc.isError,
              });
            }
          } else if (part.kind === "text") {
            const text = this.textBlocks[part.blockIndex];
            if (text) {
              historyParts.push({ type: "text", text });
            }
          }
        }
        // Fallback: if no text was captured in orderedParts, use resultText
        if (!this.orderedParts.some(p => p.kind === "text") && resultText) {
          historyParts.push({ type: "text", text: resultText });
        }
        // stopReason is required — without it, isRunInProgressFromHistory thinks the run is still active
        historyStore.push({
          role: "assistant",
          content: historyParts,
          timestamp: Date.now(),
          reasoning: fullReasoning || undefined,
          runId,
          model: msg.model,
          stopReason: msg.stop_reason || "end_turn",
        });

        // Capture stats from result message
        this.runStats.durationMs = msg.duration_ms || 0;
        this.runStats.durationApiMs = msg.duration_api_ms || 0;
        this.runStats.numTurns = msg.num_turns || 0;
        this.runStats.costUsd = msg.cost_usd || 0;
        this.runStats.model = msg.model || null;
        if (msg.usage) {
          if (msg.usage.input_tokens) this.runStats.inputTokens = msg.usage.input_tokens;
          if (msg.usage.output_tokens) this.runStats.outputTokens = msg.usage.output_tokens;
          if (msg.usage.cache_creation_input_tokens) this.runStats.cacheCreationInputTokens = msg.usage.cache_creation_input_tokens;
          if (msg.usage.cache_read_input_tokens) this.runStats.cacheReadInputTokens = msg.usage.cache_read_input_tokens;
        }

        // Accumulate session stats
        this.sessionStats.totalInputTokens += this.runStats.inputTokens;
        this.sessionStats.totalOutputTokens += this.runStats.outputTokens;
        this.sessionStats.totalCacheCreationInputTokens += this.runStats.cacheCreationInputTokens;
        this.sessionStats.totalCacheReadInputTokens += this.runStats.cacheReadInputTokens;
        this.sessionStats.totalCostUsd += this.runStats.costUsd;
        this.sessionStats.totalDurationMs += this.runStats.durationMs;
        this.sessionStats.totalApiCalls += this.runStats.apiCalls;
        this.sessionStats.totalRuns++;

        // Persist to module-level store + disk
        Object.assign(persistentStats.session, this.sessionStats);
        persistentStats.runs.push({ ...this.runStats, completedAt: Date.now(), runId });
        if (persistentStats.runs.length > MAX_RUNS) {
          persistentStats.runs = persistentStats.runs.slice(-MAX_RUNS);
        }
        void persistStatsToDisk(this.config.statsPath);

        // Log run stats
        const s = this.runStats;
        const cacheInfo = (s.cacheCreationInputTokens || s.cacheReadInputTokens)
          ? ` cache_write=${formatTokens(s.cacheCreationInputTokens)} cache_read=${formatTokens(s.cacheReadInputTokens)}`
          : "";
        console.log(
          `[stats] Run complete: ` +
          `in=${formatTokens(s.inputTokens)} out=${formatTokens(s.outputTokens)}${cacheInfo} ` +
          `cost=$${s.costUsd.toFixed(4)} duration=${(s.durationMs / 1000).toFixed(1)}s ` +
          `api_time=${(s.durationApiMs / 1000).toFixed(1)}s turns=${s.numTurns} api_calls=${s.apiCalls} ` +
          `model=${s.model || "unknown"} tools=${this.toolCalls.size}`
        );
        const ss = this.sessionStats;
        console.log(
          `[stats] Session totals (${ss.totalRuns} runs): ` +
          `in=${formatTokens(ss.totalInputTokens)} out=${formatTokens(ss.totalOutputTokens)} ` +
          `cost=$${ss.totalCostUsd.toFixed(4)} duration=${(ss.totalDurationMs / 1000).toFixed(1)}s`
        );

        // Lifecycle end — include stats
        this.sendEvent("agent", {
          runId,
          sessionKey: SESSION_KEY,
          stream: "lifecycle",
          data: {
            phase: "end",
            stats: {
              inputTokens: s.inputTokens,
              outputTokens: s.outputTokens,
              cacheCreationInputTokens: s.cacheCreationInputTokens,
              cacheReadInputTokens: s.cacheReadInputTokens,
              costUsd: s.costUsd,
              durationMs: s.durationMs,
              durationApiMs: s.durationApiMs,
              numTurns: s.numTurns,
              apiCalls: s.apiCalls,
              model: s.model,
            },
            sessionStats: {
              totalInputTokens: ss.totalInputTokens,
              totalOutputTokens: ss.totalOutputTokens,
              totalCostUsd: ss.totalCostUsd,
              totalRuns: ss.totalRuns,
            },
          },
          seq: this.seq,
          ts: Date.now(),
        });

        // Chat final (no message) — signals the client to clear streaming state.
        // Deliberately omitting `message` so the streamed interleaved content
        // (thinking/tool blocks) built via agent events is preserved as-is.
        this.sendEvent("chat", {
          runId,
          sessionKey: SESSION_KEY,
          state: "final",
        });

        console.log(`[bridge] >> run complete runId=${runId} textLen=${resultText.length} reasoningBlocks=${this.reasoningBlocks.length} tools=${this.toolCalls.size}`);

        this.justFinishedAt = Date.now();
        this.activeRunId = null;
        moduleActiveRunId = null;
        this.accumulatedText = "";
        this.reasoningBlocks = [];
        this.textBlocks = [];
        this.currentTextBlockIndex = -1;
        this.orderedParts = [];
        this.seenToolIds.clear();
        this.toolCalls.clear();
        break;
      }

      case "stream_event": {
        // Handle thinking/reasoning from stream events
        const evt = msg.event;
        if (!evt) break;

        // Track token usage from message_start and message_delta events
        if (evt.type === "message_start" && evt.message?.usage) {
          const u = evt.message.usage;
          this.runStats.inputTokens += u.input_tokens || 0;
          this.runStats.outputTokens += u.output_tokens || 0;
          this.runStats.cacheCreationInputTokens += u.cache_creation_input_tokens || 0;
          this.runStats.cacheReadInputTokens += u.cache_read_input_tokens || 0;
          this.runStats.apiCalls++;
        }

        if (evt.type === "message_delta" && evt.usage) {
          this.runStats.outputTokens += evt.usage.output_tokens || 0;
        }

        if (evt.type === "content_block_start" && evt.content_block?.type === "thinking") {
          // A new thinking block means the model processed prior tool results.
          // Resolve any tools that didn't get an explicit tool_result message.
          this.resolveUnresolvedTools(runId);
          // Reset text tracking — the next assistant turn sends fresh content,
          // not a continuation of the previous turn's cumulative text.
          this.accumulatedText = "";
          this.currentTextBlockIndex = -1;
          // Start a new reasoning block
          const blockIndex = this.reasoningBlocks.length;
          this.reasoningBlocks.push("");
          this.orderedParts.push({ kind: "thinking", blockIndex });
          this.sendEvent("agent", {
            runId,
            sessionKey: SESSION_KEY,
            stream: "reasoning",
            data: { newBlock: true },
            seq: this.seq,
            ts: Date.now(),
          });
        }

        if (evt.type === "content_block_delta" && evt.delta?.type === "thinking_delta") {
          const delta = evt.delta.thinking || "";
          if (delta) {
            // Append to current reasoning block
            if (this.reasoningBlocks.length > 0) {
              this.reasoningBlocks[this.reasoningBlocks.length - 1] += delta;
            } else {
              this.reasoningBlocks.push(delta);
            }
            this.sendEvent("agent", {
              runId,
              sessionKey: SESSION_KEY,
              stream: "reasoning",
              data: { delta },
              seq: this.seq,
              ts: Date.now(),
            });
          }
        }
        break;
      }

      // control_response, user echo, etc. — skip
      default:
        break;
    }
  }

  private summarizeSdkMessage(msg: any): string | null {
    switch (msg.type) {
      case "system":
        return `system session=${msg.session_id} model=${msg.model}`;
      case "assistant": {
        const blocks = msg.message?.content;
        if (!Array.isArray(blocks)) return `assistant (no content)`;
        const types = blocks.map((b: any) => b.type).join(",");
        const textLen = blocks.filter((b: any) => b.type === "text").reduce((n: number, b: any) => n + (b.text?.length || 0), 0);
        return `assistant blocks=[${types}] textLen=${textLen}`;
      }
      case "tool_use":
        return `tool_use name=${msg.tool_name} id=${msg.tool_use_id}`;
      case "tool_result":
        return `tool_result name=${msg.tool_name} id=${msg.tool_use_id} error=${msg.is_error}`;
      case "result":
        return `result subtype=${msg.subtype} error=${msg.is_error} duration=${msg.duration_ms}ms`;
      case "stream_event":
        return `stream_event event.type=${msg.event?.type} delta.type=${msg.event?.delta?.type || "-"} block.type=${msg.event?.content_block?.type || "-"}`;
      case "control_response":
        console.log(`[sdk] control_response id=${msg.request_id} ok=${msg.ok} error=${msg.error || "-"}`);
        return null;
      case "rate_limit_event":
        return null;
      default:
        return `${msg.type} ${JSON.stringify(msg).slice(0, 120)}`;
    }
  }

  /** Build history parts from the current streaming state (for abort/disconnect). */
  private buildCurrentParts(): Array<Record<string, unknown>> {
    const parts: Array<Record<string, unknown>> = [];
    for (const part of this.orderedParts) {
      if (part.kind === "thinking") {
        const text = this.reasoningBlocks[part.blockIndex];
        if (text) parts.push({ type: "thinking", thinking: text });
      } else if (part.kind === "tool") {
        const tc = this.toolCalls.get(part.toolCallId);
        if (tc) {
          parts.push({
            type: "tool_call",
            name: tc.name,
            toolCallId: tc.toolCallId,
            arguments: tc.args,
            status: tc.isError ? "error" : "success",
            result: tc.result,
            resultError: tc.isError,
          });
        }
      } else if (part.kind === "text") {
        const text = this.textBlocks[part.blockIndex];
        if (text) parts.push({ type: "text", text });
      }
    }
    // Fallback if no text was tracked in orderedParts
    if (!this.orderedParts.some(p => p.kind === "text") && this.accumulatedText) {
      parts.push({ type: "text", text: this.accumulatedText });
    }
    return parts;
  }

  async destroy() {
    this.clearResponseTimer();

    if (this.activeRunId) {
      // Run was in progress — eagerly push an aborted entry BEFORE awaiting
      // kill(), so that a reconnecting client's chat.history sees a complete
      // assistant message instead of a dangling user message that would trip
      // isRunInProgressFromHistory and leave the UI stuck in "Thinking...".
      historyStore.push({
        role: "assistant",
        content: this.buildCurrentParts(),
        timestamp: Date.now(),
        stopReason: "aborted",
        runId: this.activeRunId,
      });
      this.activeRunId = null;
      moduleActiveRunId = null;
      this.accumulatedText = "";
      this.reasoningBlocks = [];
      this.orderedParts = [];
      this.seenToolIds.clear();
      this.toolCalls.clear();
      await this.claude.kill();
      moduleClaude = null; // process is dead; spawn fresh on next connect
    } else {
      // No active run — keep the process alive so the next connection reuses
      // it (same session ID, same debug file, no restart delay).
      // Just detach our listeners; the new bridge will re-attach them.
      this.claude.removeAllListeners();
    }
  }
}
