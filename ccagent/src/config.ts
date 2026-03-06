import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Config {
  port?: number;
  model?: string;
  systemPrompt?: string;
  statsPath?: string;
}

/**
 * Load config from the shared 8Claw settings.json and environment variables.
 * Priority (highest to lowest):
 * 1. Environment variables (CCAGENT_PORT, CCAGENT_MODEL, CCAGENT_SYSTEM_PROMPT)
 * 2. Shared config file (CCAGENT_CONFIG env var, or .8claw/settings.json)
 * 3. Defaults
 *
 * The config file uses the same keys as the 8Claw settings UI:
 * {
 *   "CCAGENT_PORT": 4100,
 *   "MODEL": "haiku",
 *   "CCAGENT_SYSTEM_PROMPT": "You are a helpful assistant..."
 * }
 */
export function loadConfig(): Config {
  const config: Config = {};

  // Try to load shared settings file
  const configPath = process.env.CCAGENT_CONFIG || join(homedir(), ".8claw", "settings.json");
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    if (parsed.CCAGENT_PORT) {
      const port = typeof parsed.CCAGENT_PORT === "number" ? parsed.CCAGENT_PORT : parseInt(parsed.CCAGENT_PORT, 10);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) config.port = port;
    }
    if (parsed.MODEL && typeof parsed.MODEL === "string") {
      config.model = parsed.MODEL;
    }
    if (parsed.CCAGENT_SYSTEM_PROMPT && typeof parsed.CCAGENT_SYSTEM_PROMPT === "string") {
      config.systemPrompt = parsed.CCAGENT_SYSTEM_PROMPT;
    }
  } catch {
    // File doesn't exist or isn't valid JSON — silently skip
  }

  // Override with env vars if set
  if (process.env.CCAGENT_PORT) {
    config.port = parseInt(process.env.CCAGENT_PORT, 10);
  }
  if (process.env.CCAGENT_MODEL) {
    config.model = process.env.CCAGENT_MODEL;
  }
  if (process.env.CCAGENT_SYSTEM_PROMPT) {
    config.systemPrompt = process.env.CCAGENT_SYSTEM_PROMPT;
  }

  // Stats file path — defaults to .8claw/ccagent-stats.json relative to CLAUDE_CWD (project root)
  // or home directory if no project cwd is set. This aligns with the 8claw API route's STATS_PATH.
  const statsBase = process.env.CLAUDE_CWD || homedir();
  config.statsPath = process.env.CCAGENT_STATS_PATH || join(statsBase, ".8claw", "ccagent-stats.json");

  return config;
}
