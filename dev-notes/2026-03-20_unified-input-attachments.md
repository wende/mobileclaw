# Unified Input Attachments with Plugin Extensibility

**Date:** 2026-03-20
**PR:** #42
**Branch:** `feat/unified-input-attachments`
**Files:** 22 changed, 1045 insertions, 129 deletions

## Summary

Replaced ChatInput's split state management (local `ImageAttachment[]` + prop-threaded `quoteText`) with a unified attachment model backed by a plugin registry. Then extended the plugin system so message plugins can inject attachments into the compose bar — bridging the two plugin surfaces for the first time.

## Problem

ChatInput managed two separate "things attached to the compose input":

1. **Image/file attachments** — `useState<ImageAttachment[]>` local to ChatInput, with its own add/remove/cleanup logic
2. **Quote text** — `string | null` in page.tsx via `useQuoteSelection`, threaded through ChatComposerBar as separate props

Both had duplicate patterns: identical dismiss button SVGs, identical `opacity: calc(1 - var(--sp, 0))` CSS, and split state that the submit function had to reconcile in two different places.

## Design: Mirroring the Message Plugin System

The existing message plugin system has a clean pattern:
- `MobileClawPlugin<TData>` — type discriminator, parse, render
- `pluginRegistry` — build-time map of builtins + app plugins
- `PluginRenderer` — delegates to registry, falls back gracefully

The input attachment system mirrors this exactly:

```
MobileClawPlugin<TData>           InputAttachmentPlugin<TData>
  type: string                      kind: string
  parse(raw) → result               (runtime data, no parse needed)
  render(props) → ReactNode         renderPreview(props) → ReactNode
                                    toSendContribution(data) → { textPrefix?, images? }
                                    cleanup?(data) → void

pluginRegistry                    inputAttachmentRegistry
  get(type)                         get(kind)
  list()                            list()

builtinPlugins[]                  builtinInputAttachmentPlugins[]
appPlugins[]                      appInputAttachmentPlugins[]
```

### Storage model

`InputAttachment` is a generic envelope rather than a discriminated union:

```ts
interface InputAttachment {
  kind: string;
  data: unknown;
}
```

This means new kinds don't require touching the type definition — just register a plugin.

### Send flow

On submit, ChatInput collects contributions from all attachment plugins:

```ts
for (const att of attachments) {
  const plugin = inputAttachmentRegistry.get(att.kind);
  const c = plugin.toSendContribution(att.data);
  if (c.textPrefix) textPrefixes.push(c.textPrefix);
  if (c.images) allImages.push(...c.images);
}
```

The downstream `onSend(text, ImageAttachment[])` signature is unchanged. This was intentional — changing the send protocol would've cascaded through `useQueuedMessage`, `useMessageSender`, the WS send path, and demo mode. Not worth it for this PR.

## Bridging Message Plugins → Compose Bar

Added `addInputAttachment?: (kind: string, data: unknown) => void` to `PluginViewProps` and threaded it through:

```
page.tsx (useInputAttachments().add)
  → ChatViewport
    → MessageRow
      → PluginRenderer
        → plugin.render(props)  // props.addInputAttachment available
```

This lets any message plugin inject an attachment into the compose bar. The `context_chip` demo plugin uses this: it renders an "Attach" button, and on click calls `addInputAttachment("prompt_context", { label, context })`.

## Custom Rendering in User Messages

The `prompt_context` attachment contributes `> [context: label]\n> body lines` as its text prefix. `UserTextWithQuotes` was extended to detect `[context: ...]` headers on quoted blocks and render them as styled document cards instead of plain left-border blockquotes.

This approach avoids changing the send protocol while still getting a custom render. The `[context: ...]` marker is an internal convention — if a user manually types `> [context: foo]` they'd get the styled card too, but that's an acceptable edge case.

## Key decisions

**Generic envelope vs discriminated union.** Started with a TypeScript discriminated union (`{ kind: "image"; ... } | { kind: "file"; ... } | { kind: "quote"; ... }`). Changed to `{ kind: string; data: unknown }` when adding plugin extensibility — a discriminated union requires modifying the type definition for each new kind, which defeats the purpose of a registry.

**No `parse` on input attachment plugins.** Message plugins have `parse()` because data arrives from an untrusted server. Input attachment data is created locally by trusted client code, so validation isn't needed.

**`cleanup` is optional.** Only image/file plugins need it (to revoke object URLs). Quote and prompt_context don't allocate resources. The hook calls `cleanup` through the registry rather than checking kind strings.

**`toSendContribution` not `toContentParts`.** Considered having plugins produce arbitrary `ContentPart[]` for the sent message, but that would've required changing the `onSend` signature and cascading through 4+ files. The `textPrefix` + `images` contribution model works within the existing protocol.

## Files

### New
- `hooks/chat/useInputAttachments.ts` — unified attachment state + registry-delegated cleanup
- `lib/plugins/inputAttachmentTypes.ts` — `InputAttachmentPlugin` interface
- `lib/plugins/inputAttachmentBuiltins.tsx` — image, file, quote preview renderers + send contributions
- `lib/plugins/inputAttachmentRegistry.ts` — registry combining builtins + app plugins
- `plugins/app/contextChip.tsx` — `context_chip` message plugin + `prompt_context` input attachment plugin
- `tests/useInputAttachments.test.tsx` — 8 tests
- `tests/inputAttachmentRegistry.test.ts` — 6 tests
- `tests/inputAttachmentPlugins.test.tsx` — 8 tests
- `tests/contextChipPlugin.test.tsx` — 9 tests

### Modified
- `types/chat.ts` — `InputAttachment` type (generic envelope)
- `lib/plugins/types.ts` — `addInputAttachment` on `PluginViewProps`
- `components/ChatInput.tsx` — removed local state, delegates to registry
- `components/chat/ChatComposerBar.tsx` — unified attachment props
- `components/chat/ChatViewport.tsx` — threads `onAddInputAttachment`
- `components/MessageRow.tsx` — threads `onAddInputAttachment`, context block rendering in `UserTextWithQuotes`
- `components/plugins/PluginRenderer.tsx` — passes `onAddInputAttachment` to plugins
- `app/page.tsx` — wires `useInputAttachments` hook + quote bridge
- `lib/demoMode.ts` — `attach` keyword trigger, help table entry
- `plugins/app/index.ts` — registers both app plugins
- `docs/plugin-system.md` — full Input Attachment Plugins section
- `tests/demoMode.test.ts` — attach keyword test
