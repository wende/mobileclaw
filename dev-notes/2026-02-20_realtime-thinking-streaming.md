# Real-Time Thinking/Reasoning Streaming from OpenClaw

**Date:** 2026-02-20
**Status:** Blocked on backend

## Problem

OpenClaw's WebSocket protocol doesn't stream thinking/reasoning content in real-time during agent turns. Thinking blocks only become available after the turn completes via `chat.history`. Users can't see the model thinking live (like claude.ai does).

## What's Ready on the Client

MobileClaw's UI is fully built to handle real-time thinking:

- **ThinkingPill** (`MessageRow.tsx`) — expandable pill with brain icon, animated dots, elapsed time tracking, slide animations
- **ThinkingIndicator** (`ThinkingIndicator.tsx`) — "Thinking..." display with elapsed timer
- **Reasoning stream handler** (`page.tsx`) — processes `event:agent` with `stream: "reasoning"`, appends deltas to message parts
- **Preview extraction** — shows last complete sentence as thinking streams in (regex: `/[^.]*\./g`)
- **Multiple thinking sources** — supports `message.reasoning`, `type: "thinking"` content parts, and `<think>...</think>` XML tags (LM Studio)

## What's Blocking

OpenClaw's `emitReasoningStream` in `src/agents/pi-embedded-subscribe.ts`:
- Currently only invokes `params.onReasoningStream` internally
- Does **not** emit an `event:agent` over WebSocket during the streaming phase
- Thinking data is only available post-completion through `chat.history`

Tracked as **OpenClaw issue #5086**.

## Required Backend Fix

`emitReasoningStream` needs to additionally emit an `event:agent` event containing thinking data during streaming, not just post-completion. Once that's in place, MobileClaw will display it in real-time with no client changes needed.

## Current Workaround

Thinking content appears after the turn ends when `chat.history` is reloaded. The UI renders it correctly — just not live.
