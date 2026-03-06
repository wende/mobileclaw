import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Config {
  port?: number;
  model?: string;
  systemPrompt?: string;
}

/**
 * Load config from file and environment variables.
 * Priority (highest to lowest):
 * 1. Environment variables (CCAGENT_PORT, CCAGENT_MODEL, CCAGENT_SYSTEM_PROMPT)
 * 2. Config file (CCAGENT_CONFIG or ~/.ccagent.json)
 * 3. Defaults
 *
 * Example ~/.ccagent.json:
 * {
 *   "port": 4100,
 *   "model": "claude-opus-4-6",
 *   "systemPrompt": "You are a helpful assistant..."
 * }
 */
export function loadConfig(): Config {
  const config: Config = {};

  // Try to load config file
  const configPath = process.env.CCAGENT_CONFIG || join(homedir(), ".ccagent.json");
  try {
    const fileContent = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(fileContent);
    if (parsed.port && typeof parsed.port === "number") {
      config.port = parsed.port;
    }
    if (parsed.model && typeof parsed.model === "string") {
      config.model = parsed.model;
    }
    if (parsed.systemPrompt && typeof parsed.systemPrompt === "string") {
      config.systemPrompt = parsed.systemPrompt;
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

  return config;
}
