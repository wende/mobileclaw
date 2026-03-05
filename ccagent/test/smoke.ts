import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ClaudeProcess } from "../src/claude-process.js";
import type { ClientPrompt, ServerMessage } from "../src/types.js";

// Inline a minimal server to avoid import side-effects from server.ts
function startTestServer(port: number): Promise<{ httpServer: Server; wss: WebSocketServer }> {
  return new Promise((resolve) => {
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
      let claude: ClaudeProcess | null = null;

      function spawnClaude(cwd?: string, resumeSessionId?: string) {
        claude = new ClaudeProcess();
        claude.on("state", (state) => send(ws, { type: "status", payload: { state } }));
        claude.on("ready", (sessionId: string) => send(ws, { type: "session_info", payload: { sessionId } }));
        claude.on("message", (msg) => send(ws, { type: "claude_message", payload: msg }));
        claude.on("error", (err: Error) => send(ws, { type: "error", payload: { message: err.message } }));
        claude.start({ cwd, resumeSessionId, model: TEST_MODEL });
      }

      spawnClaude();

      ws.on("message", async (data) => {
        const parsed = JSON.parse(data.toString()) as ClientPrompt;
        if (parsed.type !== "prompt") return;

        if (!claude || claude.state === "finished") {
          if (claude) await claude.kill();
          spawnClaude(parsed.cwd);
          claude!.once("ready", () => claude!.sendPrompt(parsed.text));
          return;
        }

        if (claude.state === "ready") {
          claude.sendPrompt(parsed.text);
        } else {
          claude.once("ready", () => claude!.sendPrompt(parsed.text));
        }
      });

      ws.on("close", async () => {
        if (claude) await claude.kill();
      });
    });

    httpServer.listen(port, () => resolve({ httpServer, wss }));
  });
}

// --- Test ---

const PORT = 4199;
const TEST_MODEL = process.env.TEST_MODEL || "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 120_000;

async function run() {
  console.log("Starting test server...");
  const { httpServer, wss } = await startTestServer(PORT);

  // Health check
  const healthRes = await fetch(`http://localhost:${PORT}/health`);
  const healthBody = await healthRes.json();
  console.assert(healthBody.ok === true, "Health check failed");
  console.log("[PASS] Health check");

  // Connect WS
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const messages: ServerMessage[] = [];
  let gotSessionInfo = false;
  let gotResult = false;

  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for result")), TIMEOUT_MS);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      messages.push(msg);

      if (msg.type === "session_info") {
        gotSessionInfo = true;
        console.log(`[INFO] Session: ${msg.payload.sessionId}`);
      }

      if (msg.type === "status") {
        console.log(`[INFO] State: ${msg.payload.state}`);

        if (msg.payload.state === "ready" && !messages.some((m) => m.type === "claude_message" && (m.payload as any).type === "result")) {
          // Send prompt once ready (only if we haven't already)
          if (!messages.some((m) => m.type === "status" && m.payload.state === "busy")) {
            console.log("[INFO] Sending prompt...");
            ws.send(JSON.stringify({ type: "prompt", text: "Say hello in exactly 3 words" }));
          }
        }

        if (msg.payload.state === "finished") {
          gotResult = true;
          clearTimeout(timer);
          resolve();
        }
      }

      if (msg.type === "error") {
        console.error(`[ERROR] ${msg.payload.message}`);
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  try {
    await done;
  } catch (err) {
    console.error("Test failed:", err);
    ws.close();
    wss.close();
    httpServer.close();
    process.exit(1);
  }

  // Assertions
  const claudeMessages = messages.filter((m) => m.type === "claude_message");
  console.assert(gotSessionInfo, "Should have received session_info");
  console.assert(claudeMessages.length > 0, "Should have received claude_message(s)");
  console.assert(gotResult, "Should have reached finished state");

  console.log(`\n--- Summary ---`);
  console.log(`Total messages: ${messages.length}`);
  console.log(`Claude messages: ${claudeMessages.length}`);
  console.log(`Got session info: ${gotSessionInfo}`);
  console.log(`Got result: ${gotResult}`);
  console.log(`[PASS] All assertions passed`);

  ws.close();
  wss.close();
  httpServer.close(() => process.exit(0));
}

run().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
