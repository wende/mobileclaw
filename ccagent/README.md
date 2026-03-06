# ccagent

A WebSocket server that bridges Claude Code CLI with OpenClaw clients (like MobileClaw).

## Configuration

ccagent supports configuration via:

1. **Config file** (`~/.ccagent.json` or via `$CCAGENT_CONFIG`)
2. **Environment variables** (override file settings)

### Options

- `port` — Server port (default: 4100)
- `model` — Claude model to use (e.g., `claude-opus-4-6`)
- `systemPrompt` — System prompt to prepend to all conversations

### Example ~/.ccagent.json

```json
{
  "port": 4100,
  "model": "claude-opus-4-6",
  "systemPrompt": "You are a helpful assistant specializing in software engineering."
}
```

### Environment Variables

```bash
CCAGENT_PORT=4100
CCAGENT_MODEL=claude-opus-4-6
CCAGENT_SYSTEM_PROMPT="You are a helpful assistant..."
CCAGENT_CONFIG=/path/to/config.json  # Override default config path
PORT=4100                            # Fallback if CCAGENT_PORT not set
```

### Priority (highest to lowest)

1. Environment variables (`CCAGENT_*`)
2. Config file settings
3. Defaults (port 4100, Haiku model, no system prompt)
4. Legacy `PORT` env var (fallback only)

## Running

```bash
npm start                          # Default: port 4100
PORT=3000 npm start               # Custom port
CCAGENT_MODEL=claude-opus-4-6 npm start  # Override model
```

## Testing

```bash
npm test
```

## WebSocket Protocol

Clients connect to the WebSocket and:

1. Receive `event:connect.challenge` with nonce
2. Send `req:connect` to authenticate
3. Receive `res:hello-ok` with server info
4. Send `req:chat.send` with messages and optional `systemPrompt` (per-request override)
5. Receive streaming `event:agent` and `event:chat` messages
