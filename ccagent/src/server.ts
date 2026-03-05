import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ClaudeProcess } from "./claude-process.js";
import type { ClientPrompt, ServerMessage } from "./types.js";

const PORT = parseInt(process.env.PORT || "4100", 10);
const MODEL = process.env.MODEL || undefined;

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server: httpServer });

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

wss.on("connection", (ws) => {
  console.log("[ws] Client connected");
  let claude: ClaudeProcess | null = null;

  function spawnClaude(cwd?: string, resumeSessionId?: string) {
    console.log(`[server] Spawning claude process${resumeSessionId ? ` (resume: ${resumeSessionId})` : ""}${MODEL ? ` (model: ${MODEL})` : ""}`);
    claude = new ClaudeProcess();

    claude.on("state", (state) => {
      console.log(`[claude] State: ${state}`);
      send(ws, { type: "status", payload: { state } });
    });

    claude.on("ready", (sessionId: string) => {
      console.log(`[claude] Ready, session: ${sessionId}`);
      send(ws, { type: "session_info", payload: { sessionId } });
    });

    claude.on("message", (msg) => {
      console.log(`[claude] Message: type=${msg.type}${msg.type === "assistant" ? "" : ""}`);
      send(ws, { type: "claude_message", payload: msg });
    });

    claude.on("error", (err: Error) => {
      console.error("[claude] Error:", err.message);
      send(ws, { type: "error", payload: { message: err.message } });
    });

    claude.on("exit", (code: number | null, signal: string | null) => {
      console.log(`[claude] Process exited code=${code} signal=${signal}`);
    });

    claude.start({ cwd, resumeSessionId, model: MODEL });
  }

  // Spawn immediately on connect
  console.log("[server] New connection, spawning claude process");
  spawnClaude();

  ws.on("message", async (data) => {
    const raw = data.toString();
    console.log(`[ws] Received from client: ${raw}`);

    let parsed: ClientPrompt;
    try {
      parsed = JSON.parse(raw) as ClientPrompt;
    } catch {
      console.log("[ws] Failed to parse as JSON");
      send(ws, { type: "error", payload: { message: "Invalid JSON" } });
      return;
    }

    if (parsed.type !== "prompt") {
      console.log(`[ws] Unknown message type: ${parsed.type}`);
      send(ws, {
        type: "error",
        payload: { message: `Unknown message type: ${parsed.type}` },
      });
      return;
    }

    console.log(`[ws] Prompt received: "${parsed.text.slice(0, 100)}..." (state=${claude?.state}, sessionId=${claude?.sessionId})`);

    // If client specifies a sessionId different from current, resume it
    if (parsed.sessionId && parsed.sessionId !== claude?.sessionId) {
      console.log(`[server] Resuming session ${parsed.sessionId}`);
      if (claude) await claude.kill();
      spawnClaude(parsed.cwd, parsed.sessionId);
      claude!.once("ready", () => {
        claude!.sendPrompt(parsed.text);
      });
      return;
    }

    // If process finished or not yet ready, respawn
    if (!claude || claude.state === "finished") {
      console.log("[server] Process finished or missing, respawning");
      if (claude) await claude.kill();
      spawnClaude(parsed.cwd);
      claude!.once("ready", () => {
        claude!.sendPrompt(parsed.text);
      });
      return;
    }

    if (claude.state === "ready") {
      console.log("[server] Sending prompt to claude process");
      claude.sendPrompt(parsed.text);
    } else {
      console.log(`[server] Claude not ready (state=${claude.state}), queuing prompt`);
      claude.once("ready", () => {
        claude!.sendPrompt(parsed.text);
      });
    }
  });

  ws.on("close", async () => {
    console.log("[ws] Client disconnected");
    if (claude) await claude.kill();
    claude = null;
  });
});

httpServer.listen(PORT, () => {
  console.log(`ccagent listening on :${PORT}`);
});

// Graceful shutdown
function shutdown() {
  console.log("\nShutting down...");
  wss.clients.forEach((ws) => ws.close());
  httpServer.close(() => process.exit(0));
  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
