# NullClaw Compatibility Report for MobileClaw

**Date:** 2026-03-03
**Subject:** What changes MobileClaw needs to support NullClaw WebChannel v1 as an alternative backend

---

## Protocol Comparison

| | OpenClaw (current) | NullClaw WebChannel v1 |
|---|---|---|
| **Envelope** | `{type: "req"/"res"/"event", ...}` | `{v: 1, type: "<event_name>", session_id, payload}` |
| **Handshake** | Challenge-nonce + Ed25519 signing | 6-digit pairing code → JWT |
| **User message** | `req:chat.send` (request/response) | `user_message` event (fire-and-forget) |
| **Streaming** | `event:chat` (delta/final/aborted/error) + `event:agent` (content/tool/reasoning/lifecycle) | `assistant_chunk` (N×) + `assistant_final` |
| **Tools** | `event:agent` stream=tool, phase=start/result | `tool_call` + `tool_result` flat events |
| **Reasoning** | `event:agent` stream=reasoning | Not in spec |
| **History** | `req:chat.history` → messages array | **Not available** — ephemeral sessions |
| **Sessions** | `sessions.list`, server-assigned keys | `session_id` query param at connect, no enumeration API |
| **Models/Config** | `req:models.list`, `req:config.get` | Not available |
| **Abort** | `req:chat.abort` | Not available |
| **Approvals** | Not available | `approval_request` / `approval_response` |
| **E2E encryption** | Not available | X25519 + ChaCha20-Poly1305 |

---

## NullClaw WebChannel v1 Protocol Summary

Every WS message is a JSON text frame with a fixed envelope:

```json
{
  "v": 1,
  "type": "<event_name>",
  "session_id": "<string>",
  "agent_id": "<optional>",
  "request_id": "<optional>",
  "payload": { ... },
  "access_token": "<JWT, optional>",
  "auth_token": "<static token, optional>"
}
```

### Event Types

| Event | Direction | Payload |
|---|---|---|
| `pairing_request` | UI→Core | `pairing_code`, optional `client_pub` (X25519) |
| `pairing_result` | Core→UI | `ok`, `client_id`, `access_token` (JWT), `expires_in`, `e2e` info |
| `user_message` | UI→Core | `content`, `access_token` |
| `assistant_chunk` | Core→UI | `content` (streamed tokens) |
| `assistant_final` | Core→UI | `content` (complete) |
| `tool_call` | Core→UI | `name`, `arguments` |
| `tool_result` | Core→UI | `ok`, `result`, `error` |
| `approval_request` | Core→UI | `action`, `reason` |
| `approval_response` | UI→Core | `approved`, `reason` |
| `error` | Both | `code`, `message` |

### Auth Flow

1. Browser opens WS to `ws://127.0.0.1:32123/ws?session_id=default`
2. Client sends `pairing_request` with 6-digit code (local mode: `123456`)
3. Server responds `pairing_result` with JWT `access_token` (TTL up to 30 days)
4. All subsequent `user_message` events include `access_token` in envelope
5. Token stored in `localStorage` under `nullclaw_ui_auth_v1` for session restore

### Streaming Flow

```
→ user_message
← assistant_chunk  (repeated N times)
← tool_call        (if tool invoked)
← tool_result      (tool output)
← assistant_chunk  (agent continues)
← assistant_final  (done)
```

---

## Changes Required by File

### New: Protocol Adapter Layer

Recommended approach — create `lib/adapters/` with a backend-agnostic interface:

```
lib/adapters/types.ts         — shared adapter interface
lib/adapters/openclaw.ts      — current protocol (extract from useOpenClawRuntime)
lib/adapters/nullclaw.ts      — NullClaw WebChannel v1 translation
```

The adapter normalizes NullClaw events into MobileClaw's internal event model so UI components stay untouched.

### `types/chat.ts` — Protocol Type Additions

- Add NullClaw envelope type (`v`, `type`, `session_id`, `payload`, `access_token`)
- Add NullClaw event types (or keep internal to the adapter)

### `hooks/chat/useOpenClawRuntime.ts` — Heaviest Change

| Function | Change |
|---|---|
| `handleConnectChallenge()` | Replace with `pairing_request` → `pairing_result` flow |
| `handleHelloOk()` | Replace with `pairing_result` handler (extract JWT, store) |
| `handleChatEvent()` | Map `assistant_chunk` → delta, `assistant_final` → final. No `aborted` state in NullClaw |
| `handleAgentEvent()` | Map `tool_call`/`tool_result` flat events. No lifecycle/reasoning/content sub-streams |
| `handleHistoryResponse()` | Stub out — NullClaw has no history API |
| `handleWSMessage()` routing | Rewrite: NullClaw uses `type` directly, not `req`/`res`/`event` wrapping |
| Request ID routing (`conn-*`, `run-*`, etc.) | NullClaw uses optional `request_id`, not prefix-based routing |

### `lib/deviceIdentity.ts` + `lib/nativeBridge.ts` — Auth Replacement

- Ed25519 nonce-challenge signing not used by NullClaw
- Replace with: pairing code input → `pairing_request` → store JWT from `pairing_result`
- iOS native bridge `identity:sign` path unused; needs new `pairing:submit` bridge message or handle in JS
- Token persistence: `{endpoint, access_token, shared_key, expires_at}` in localStorage

### `hooks/chat/useMessageSender.ts` — Simpler

- `req:chat.send` → NullClaw `user_message` event
- `user_message` carries `access_token` in envelope
- Fire-and-forget (no `res:` response expected)

### `hooks/useSessionSwitcher.ts` — Major Gap

- NullClaw has no `sessions.list` — cannot enumerate conversations
- Session ID set at WS connect time via query param, immutable mid-connection
- Switching sessions: disconnect and reconnect with `?session_id=<new>`
- Session list UI must be driven by client-side localStorage, not server

### `hooks/usePullToRefresh.ts` — Disabled

- Pull-to-refresh sends `req:chat.history` — no NullClaw equivalent
- Disable or repurpose (e.g., reconnect)

### `hooks/useSubagentStore.ts` — Unknown

- NullClaw has `agent_id` in envelope for multi-agent routing, but no docs on behavior
- Subagent spawn/child-session model likely unsupported
- Stub out or wait for NullClaw to document multi-agent

### `app/page.tsx` — Stop Button

- `req:chat.abort` has no NullClaw equivalent
- Hide or disable stop button

### `lib/parseBackendModels.ts` — Disabled

- `config.get` and `models.list` have no equivalents
- Model selection UI: hide or hardcode

### `lib/useWebSocket.ts` — Minor

- Transport layer mostly stays as-is
- URL includes query params (`?session_id=...&token=...`)
- `markEstablished()` called after `pairing_result` instead of `hello-ok`

---

## Critical Gaps (No Workaround)

| Gap | Impact | Severity |
|---|---|---|
| **No chat history API** | Messages lost on reload/reconnect | **High** |
| **No abort/stop** | Can't interrupt running agent | **Medium** |
| **No reasoning events** | Thinking blocks not surfaced | **Medium** |
| **No session enumeration** | Can't show conversation list | **Medium** |
| **No model/config API** | Can't switch models | **Low** |

## Features That Map Well

| Feature | Notes |
|---|---|
| **Text streaming** | `assistant_chunk` → delta, `assistant_final` → final. Clean 1:1 |
| **Tool calls** | `tool_call`/`tool_result` simpler but mappable |
| **Approval requests** | NullClaw has native `approval_request`/`approval_response` — OpenClaw doesn't |
| **E2E encryption** | X25519 + ChaCha20-Poly1305 — new capability for MobileClaw |
| **Reconnection** | Token restore from localStorage maps to existing reconnect logic |

## Estimated Scope

- **~13 files** directly protocol-coupled
- **~3 files** newly created (adapter layer)
- **~4 features** degraded or disabled (history, abort, reasoning, session list)
- Adapter pattern keeps OpenClaw working while adding NullClaw behind a runtime switch

## Sources

- [NullClaw repo](https://github.com/nullclaw/nullclaw)
- [WebChannel v1 spec](https://raw.githubusercontent.com/nullclaw/nullclaw/main/spec/webchannel_v1.json)
- [nullclaw-chat-ui](https://github.com/nullclaw/nullclaw-chat-ui)
- [NullClaw architecture docs](https://nullclaw.github.io/architecture.html)
