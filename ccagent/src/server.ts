import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { OpenClawBridge, getStats } from "./openclaw-bridge.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const PORT = config.port || parseInt(process.env.PORT || "4100", 10);
const MODEL = config.model;

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === "/stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getStats()));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  console.log("[server] Client connected");
  const bridge = new OpenClawBridge(ws, { model: MODEL, config });

  ws.on("close", () => {
    console.log("[server] Client disconnected");
    void bridge.destroy();
  });
});

httpServer.listen(PORT, () => {
  console.log(`ccagent listening on :${PORT}`);
  if (MODEL) console.log(`  model: ${MODEL}`);
  if (config.systemPrompt) console.log(`  systemPrompt: ${config.systemPrompt.slice(0, 50)}...`);
});

// Graceful shutdown
function shutdown() {
  console.log("\nShutting down...");
  wss.clients.forEach((ws) => ws.close());
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
