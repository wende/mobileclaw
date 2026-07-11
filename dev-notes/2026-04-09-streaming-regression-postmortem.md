# 2026-04-09 — Streaming Regression Post-Mortem

## The Bug

A regression in MobileClaw where the entire chat turn briefly clears before the final message arrives during streaming, then reappears — a visual "flicker" or "reversal."

## What Actually Happened

### Original cause (from commit c79003a)

Commit `c79003a` removed the `agentStreamActiveRef` guard that had been introduced in `205667b`. This guard prevented `event:chat` delta snapshots from overwriting `event:agent` stream content during streaming. Without it, both event streams update the same message concurrently, corrupting content.

### What I found through debugging

Three distinct issues were uncovered through browser testing with Chrome DevTools:

1. **Duplicate React keys (confirmed via console errors):** `buildStableHistoryId` prefers `messageId` over `runId` for assistant messages. The server assigns a `messageId` different from the client's `runId`. During `mergeHistoryWithOptimistic`, the server version gets a different ID than the streaming version, so the streaming message is "carried over" as a duplicate. React sees two children with the same key and drops one — causing the visual clearing.

2. **Dual WebSocket subscriptions (confirmed via console logs):** React StrictMode double-mounts the component, creating two WS connections to the OpenClaw gateway. Both complete their handshake and subscribe to the same session. The gateway then delivers each agent event to WS2 twice (once per subscription). The `addToolCall` function receives two identical calls in the same tick, both seeing `existingTools=0` in their `setState` updater (same `prev` snapshot), both appending a tool_call part.

3. **RunId mismatch between agent and chat events:** The gateway uses different `runId` values for `event:agent` and `event:chat` frames. The client code assumes they match. This causes agent-built parts and chat-event parts to target different messages, creating duplicate message blocks.

### What I tried (and why each failed)

| Attempt | What it did | Why it failed |
|---------|------------|---------------|
| Restore `agentStreamActiveRef` guard | Block chat deltas when agent events active | Message didn't appear at all — gateway doesn't send agent content events, so only chat events provide text content |
| `buildStableHistoryId` fix (prefer runId) | Fix duplicate React keys | Fixed the clearing, but exposed the underlying dual-event issue |
| RunId normalization in chat/agent handlers | Make both streams target same message | The chat delta handler overwrites `activeRunIdRef` before agent events can use it; lifecycle:start timing varies |
| `agentStreamActiveRef` refined (allow create, skip update) | Let chat create message, agent handles updates | RunId mismatch means the guard check can't find the existing message |
| Strip tool_use from chat event content | Prevent chat snapshots from adding tool parts | Chat deltas don't carry tool_use parts — confirmed via console logging |
| `addToolCall` dedup by name+status | Catch duplicates in state | First tool_call's status changes to "done" before duplicate arrives; match fails |
| WS cleanup (null handlers in disconnect) | Prevent first WS from completing handshake | Localhost WS connects in microseconds — onopen fires before cleanup runs |
| `useModeBootstrap` disconnect cleanup | Properly tear down first WS on StrictMode unmount | Same timing issue — first WS handshake completes before cleanup |
| Module-level dedup Set in `addToolCall` | Catch duplicates outside React state | Works for tool deduplication, but doesn't fix the second message block from chat:final |

### What actually works (partially)

- **`buildStableHistoryId` fix** — genuinely fixes the duplicate-key React crash that caused the original clearing
- **Module-level `_seenToolStarts` dedup** — genuinely fixes the duplicate tool_call from dual WS subscriptions
- **`useModeBootstrap` disconnect cleanup + `useWebSocket` disconnect handler cleanup** — reduces (but doesn't eliminate) the dual-subscription window

### What remains broken

The chat `final` event creates a second message block because its `payload.runId` differs from the agent event's runId. The `upsertChatEventMessage` can't find the existing message and creates a new one. This manifests as doubled "Done." text and two copy button sets.

## Root Cause

The OpenClaw gateway uses **different `runId` values** for `event:agent` and `event:chat` frames for the same run, AND React StrictMode creates **two gateway subscriptions** causing each event to be delivered twice. The MobileClaw client was written assuming:
1. Agent and chat events share the same `runId`
2. Each event is delivered exactly once

Both assumptions are violated.

## What Should Have Been Done

1. **Instrument first.** Add console.logs to the WS message handler, `addToolCall`, and `upsertChatEventMessage` from the start. The duplicate React key error and double `addToolCall` calls would have been visible immediately.

2. **Test each change in the browser before declaring it fixed.** I told the user multiple fixes were "ready" without testing.

3. **Fix one thing at a time.** The `buildStableHistoryId` fix alone would have resolved the original clearing complaint. Everything else was chasing new bugs introduced by my own changes.

4. **Don't fight the architecture.** The dual-event-stream design (agent + chat events) with different runIds is a gateway-level concern. Client-side normalization is fragile. The right fix is either:
   - Gateway: use the same `runId` for both streams, or
   - Gateway: deduplicate subscriptions from the same client, or
   - Client: treat the two streams as truly independent and reconcile at render time

## Files That Were Changed (now reverted)

- `lib/chat/historyResponse.ts` — `buildStableHistoryId` prefers `runId` for assistant messages; `mergeHistoryWithOptimistic` content regression protection
- `lib/chat/streamMutations.ts` — module-level `_seenToolStarts` dedup in `addToolCall`
- `lib/useWebSocket.ts` — null handlers in `disconnect()` before closing
- `hooks/chat/useModeBootstrap.ts` — return `disconnect` cleanup from bootstrap effect
- `app/page.tsx` — import and call `resetToolCallDedup` on run start
- `tests/historyResponse.test.ts` — tests for content regression protection
- `tests/chatStreamMutations.test.ts` — `resetToolCallDedup()` in beforeEach
