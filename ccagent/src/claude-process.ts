import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import treeKill from "tree-kill";
import { sendJson, createLineParser } from "./protocol.js";
import type { ProcessState, SdkMessage, SystemMessage } from "./types.js";

export class ClaudeProcess extends EventEmitter {
  private proc: ChildProcess | null = null;
  private _state: ProcessState = "spawning";
  private _sessionId: string | null = null;

  get state(): ProcessState {
    return this._state;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  private setState(state: ProcessState) {
    this._state = state;
    this.emit("state", state);
  }

  start(opts?: { cwd?: string; resumeSessionId?: string; model?: string; mcpConfig?: string }): void {
    const { cwd, resumeSessionId, model, mcpConfig } = opts ?? {};
    const args = [
      "-p",
      "--verbose",
      "--debug",
      "--output-format=stream-json",
      "--input-format=stream-json",
      "--include-partial-messages",
      "--permission-mode=bypassPermissions",
    ];

    if (model) {
      args.push("--model", model);
    }

    if (mcpConfig) {
      args.push("--mcp-config", mcpConfig, "--strict-mcp-config");
    }

    if (resumeSessionId) {
      args.push("--fork-session", "--resume", resumeSessionId);
    }

    this.setState("spawning");

    const env = { ...process.env };
    delete env.CLAUDECODE;

    const spawnCwd = cwd || process.cwd();
    console.log(`[claude] $ claude ${args.join(" ")}`);
    console.log(`[claude]   cwd: ${spawnCwd}`);

    this.proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: spawnCwd,
      env,
    });

    const lineParser = createLineParser((msg) => this.handleMessage(msg));
    this.proc.stdout!.on("data", lineParser);

    this.proc.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        console.error(`[claude stderr] ${text}`);
      }
    });

    this.proc.on("error", (err) => {
      this.emit("error", err);
    });

    this.proc.on("exit", (code, signal) => {
      this.proc = null;
      this.emit("exit", code, signal);
    });

    // Log the debug file path once it appears
    setTimeout(async () => {
      try {
        const target = await readlink(join(homedir(), ".claude/debug/latest"));
        console.log(`[claude] debug: ${target}`);
      } catch {}
    }, 2000);

    // In stream-json mode the system message arrives after the first user
    // message is sent. Mark as ready immediately so prompts can be written.
    this.setState("ready");
  }

  sendPrompt(text: string): void {
    if (!this.proc?.stdin) {
      this.emit("error", new Error("Process not running"));
      return;
    }

    this.setState("busy");
    sendJson(this.proc.stdin, {
      type: "user",
      message: {
        role: "user",
        content: text,
      },
    });
  }

  kill(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.proc || !this.proc.pid) {
        resolve();
        return;
      }
      const pid = this.proc.pid;
      treeKill(pid, "SIGTERM", (err) => {
        if (err) {
          console.error(`[tree-kill] error killing ${pid}:`, err);
        }
        resolve();
      });
    });
  }

  private handleMessage(msg: SdkMessage): void {
    this.emit("message", msg);

    if (msg.type === "system") {
      this._sessionId = (msg as SystemMessage).session_id;
      this.setState("ready");
      this.emit("ready", this._sessionId);
    }

    if (msg.type === "result") {
      this.setState("finished");
      this.emit("result", msg);
    }
  }
}
