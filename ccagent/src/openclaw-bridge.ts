/**
 * Translates between Claude Code SDK messages and OpenClaw WebSocket protocol.
 * This lets MobileClaw connect to ccagent without any client-side changes.
 */

import { v4 as uuidv4 } from "uuid";
import { WebSocket } from "ws";
import { ClaudeProcess } from "./claude-process.js";

const SESSION_KEY = "main";

// Module-level history store — survives WS reconnects
const historyStore: Array<Record<string, unknown>> = [];

interface OpenClawMsg {
  type: string;
  [key: string]: unknown;
}

export class OpenClawBridge {
  private ws: WebSocket;
  private claude: ClaudeProcess;
  private model: string | undefined;
  private seq = 0;
  private activeRunId: string | null = null;
  private accumulatedText = "";
  private reasoningBlocks: string[] = [];
  private seenToolIds = new Set<string>();
  private toolCalls = new Map<string, { name: string; toolCallId: string; args?: string; result?: string; isError?: boolean }>();
  private justFinishedAt: number | null = null;
  /** Ordered content parts as they arrive: thinking, tool_call, text — interleaved correctly */
  private orderedParts: Array<{ kind: "thinking"; blockIndex: number } | { kind: "tool"; toolCallId: string } | { kind: "text" }> = [];

  constructor(ws: WebSocket, opts?: { model?: string }) {
    this.ws = ws;
    this.model = opts?.model;
    this.claude = new ClaudeProcess();
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

    this.ws.on("close", async () => {
      console.log("[bridge] WS closed, killing claude");
      await this.claude.kill();
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
    // Spawn claude process
    this.claude.start({ model: this.model });

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

  private handleChatSend(id: string, params: Record<string, unknown>) {
    const text = params.message as string;
    if (!text) {
      this.sendRes(id, false, undefined, "No message text");
      return;
    }

    const runId = id; // Use the request id as runId
    this.activeRunId = runId;
    this.accumulatedText = "";
    this.reasoningBlocks = [];
    this.orderedParts = [];
    this.seenToolIds.clear();
    this.toolCalls.clear();

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

    this.claude.sendPrompt(text);
  }

  private async handleChatAbort(id: string, _params: Record<string, unknown>) {
    const runId = this.activeRunId;
    await this.claude.kill();

    if (runId) {
      this.sendEvent("chat", {
        runId,
        sessionKey: SESSION_KEY,
        state: "aborted",
      });
    }
    this.activeRunId = null;

    // Respawn for next prompt
    this.claude = new ClaudeProcess();
    this.setupClaude();
    this.claude.start({ model: this.model });

    this.sendRes(id, true);
  }

  private handleChatHistory(id: string) {
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
      console.log(`[bridge] Claude exited code=${code}`);
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
              this.toolCalls.set(toolCallId, { name: block.name, toolCallId, args: argsStr });
              this.orderedParts.push({ kind: "tool", toolCallId });
              this.sendEvent("agent", {
                runId,
                sessionKey: SESSION_KEY,
                stream: "tool",
                data: {
                  phase: "start",
                  name: block.name,
                  toolCallId,
                  args: block.input,
                },
                seq: this.seq,
                ts: Date.now(),
              });
            }
          }
        }

        // Send incremental text delta
        if (fullText.length > this.accumulatedText.length) {
          const delta = fullText.slice(this.accumulatedText.length);
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
        const argsStr = msg.input ? JSON.stringify(msg.input) : undefined;
        this.toolCalls.set(toolCallId, { name: msg.tool_name, toolCallId, args: argsStr });
        if (!this.seenToolIds.has(toolCallId)) {
          this.orderedParts.push({ kind: "tool", toolCallId });
        }
        this.sendEvent("agent", {
          runId,
          sessionKey: SESSION_KEY,
          stream: "tool",
          data: {
            phase: "start",
            name: msg.tool_name,
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
            name: msg.tool_name || (toolCallId && this.toolCalls.get(toolCallId)?.name) || "unknown",
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

        // History format: a single thinking part (buildHistoryMessages extracts .thinking
        // from the first one, then strips ALL thinking parts), followed by tool_call + text.
        // After buildHistoryMessages processes this, it becomes: reasoning field + tool_call + text.
        const fullReasoning = this.reasoningBlocks.filter(Boolean).join("\n\n");
        const historyParts: Array<Record<string, unknown>> = [];
        if (fullReasoning) {
          historyParts.push({ type: "thinking", thinking: fullReasoning });
        }
        for (const part of this.orderedParts) {
          if (part.kind === "tool") {
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
          }
        }
        if (resultText) {
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

        // Lifecycle end
        this.sendEvent("agent", {
          runId,
          sessionKey: SESSION_KEY,
          stream: "lifecycle",
          data: { phase: "end" },
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
        this.accumulatedText = "";
        this.reasoningBlocks = [];
        this.orderedParts = [];
        this.seenToolIds.clear();
        this.toolCalls.clear();
        break;
      }

      case "stream_event": {
        // Handle thinking/reasoning from stream events
        const evt = msg.event;
        if (!evt) break;

        if (evt.type === "content_block_start" && evt.content_block?.type === "thinking") {
          // A new thinking block means the model processed prior tool results.
          // Resolve any tools that didn't get an explicit tool_result message.
          this.resolveUnresolvedTools(runId);
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
        return null; // skip noise
      case "rate_limit_event":
        return null;
      default:
        return `${msg.type} ${JSON.stringify(msg).slice(0, 120)}`;
    }
  }

  async destroy() {
    await this.claude.kill();
  }
}
