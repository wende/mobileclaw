# MobileClaw Plugin System

*A build-time, chat-native extension model for inline widgets and interactive cards*

---

## Summary

The provided canvas spec is directionally right about one thing: MobileClaw should render live widgets inside the conversation thread, and the server should drive their state. The part that does not fit the current codebase is the proposed top-level `message.canvas` field.

MobileClaw already models assistant output as ordered `content` parts (`text`, `thinking`, `tool_call`, `image`, `file`) and renders them in sequence inside [`components/MessageRow.tsx`](../components/MessageRow.tsx). A plugin system should extend that existing content pipeline, not introduce a second message-body channel.

This design therefore proposes:

1. Plugins are registered at build time.
2. Plugins render as a new `content` part type: `plugin`.
3. The server remains the source of truth for plugin state.
4. Unknown plugin types never crash and always fall back cleanly.
5. Interactive plugins can request host-managed actions, but plugins never own transport or WebSocket logic.

The first built-in plugin capability is exactly what the canvas spec wants: inline widgets such as `status_card` and `pause_card`.

---

## Why This Differs From The Canvas Spec

The canvas design doc assumes a simplified message model:

```ts
type Message = {
  content: string
  canvas?: CanvasPayload
}
```

MobileClaw does not work that way today. In the current app:

- Messages already carry structured `content` arrays in [`types/chat.ts`](../types/chat.ts).
- Streaming mutations append or resolve parts through [`lib/chat/streamMutations.ts`](../lib/chat/streamMutations.ts).
- Chat history is rebuilt from content arrays in [`lib/chat/historyResponse.ts`](../lib/chat/historyResponse.ts).
- Assistant rendering is single-pass and order-sensitive in [`components/MessageRow.tsx`](../components/MessageRow.tsx).

Adding a top-level `canvas` field would create a parallel rendering path with duplicated logic for:

- history replay
- optimistic updates
- in-place mutation
- ordering relative to text/thinking/tool calls
- fallback handling

The safer design is to keep one extensibility model: ordered message parts.

---

## Design Principles

### 1. The chat stays primary

Plugins render inline in the thread. No side panels, drawers, or alternate surfaces are required.

### 2. Build-time only

Plugins are local React modules compiled into MobileClaw. The server can reference plugin types, but it never ships executable UI code.

### 3. Server-driven state

The client renders plugin state; it does not infer lifecycle transitions. State changes arrive in normal message history or in plugin update events.

### 4. Unknown types degrade safely

If the client sees a plugin type it does not recognize, it renders a neutral fallback rather than failing the message.

### 5. Host-owned effects

Plugins may request actions such as "POST this choice" or "emit a resume event", but the plugin host executes those effects. Plugin components do not open raw sockets, mutate the message store directly, or own backend transport.

### 6. Ordered chronology matters

Plugins are peers of text, thinking, tool calls, images, and files. Their position in the `content` array determines where they appear in the assistant response.

---

## Scope

This plugin system supports:

- inline assistant widgets
- in-place updates to an existing widget
- optional user interaction through host-managed actions
- application-specific plugin types registered by the consuming app

This plugin system does not support:

- remote code loading
- third-party marketplace installation at runtime
- arbitrary DOM injection from payload data
- plugins that replace the chat shell, composer, transport layer, or navigation model
- server-side tool/plugin execution semantics

---

## Core Model

### Message Extension

Add a new content part type instead of a top-level `canvas` field.

```ts
export type ContentPartType =
  | "text"
  | "tool_call"
  | "toolCall"
  | "thinking"
  | "image"
  | "image_url"
  | "file"
  | "plugin";

export type PluginState =
  | "pending"
  | "active"
  | "settled"
  | "tombstone";

export interface PluginContentPart {
  type: "plugin";
  partId: string;              // stable within the parent message
  pluginType: string;          // discriminator, e.g. "status_card"
  state: PluginState;
  data: unknown;               // validated by the plugin definition
  schemaVersion?: number;      // payload schema version
  revision?: number;           // monotonically increasing instance revision
}
```

`Message` itself stays structurally unchanged. The extension point lives inside `message.content`.

That matters because MobileClaw already supports mixed assistant output such as:

```ts
[
  { type: "thinking", text: "..." },
  { type: "text", text: "I started a deployment." },
  { type: "plugin", pluginType: "status_card", ... },
  { type: "text", text: "I'll update this as it progresses." }
]
```

That chronology is hard to preserve with a separate `message.canvas` field and natural with a `plugin` part.

---

## Plugin Registry

Plugins are registered locally through a build-time registry.

```ts
export type PluginParseResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  error: string;
};

export interface PluginViewProps<TData = unknown> {
  messageId: string;
  part: PluginContentPart;
  partId: string;
  state: PluginState;
  data: TData;
  isStreaming: boolean;
  invokeAction: (action: PluginAction, input?: Record<string, unknown>) => Promise<void>;
}

export interface MobileClawPlugin<TData = unknown> {
  type: string;
  schemaVersion?: number;
  parse: (raw: unknown) => PluginParseResult<TData>;
  render: (props: PluginViewProps<TData>) => React.ReactNode;
}
```

Registry shape:

```ts
export interface PluginRegistry {
  get(type: string): MobileClawPlugin | undefined;
  list(): MobileClawPlugin[];
}
```

Recommended file layout:

```text
lib/plugins/
  registry.ts
  types.ts
  hostActions.ts
  builtins.ts

components/plugins/
  PluginRenderer.tsx
  UnknownPluginCard.tsx
  InvalidPluginCard.tsx

plugins/
  builtins/
    statusCard.tsx
    pauseCard.tsx
  app/
    index.ts
```

The consuming app exports its plugin list from a single entrypoint, for example `plugins/app/index.ts`, and the core registry merges built-ins with app plugins.

---

## Rendering

`MessageRow` remains the single assistant renderer. It gains one more content-part branch.

```tsx
if (part.type === "plugin") {
  pushAssistantBlock(
    `plugin-${part.partId}`,
    <PluginRenderer
      part={part}
      messageId={message.id ?? ""}
      isStreaming={isStreaming}
    />
  );
  return;
}
```

`PluginRenderer` resolves the plugin by `pluginType`, validates `data`, and renders one of three outcomes:

1. Known type + valid data: render plugin component
2. Known type + invalid data: render `InvalidPluginCard`
3. Unknown type: render `UnknownPluginCard`

This keeps fallback behavior consistent and localizes validation errors to one place.

---

## Transport And Update Protocol

### History and final messages

Whenever possible, plugin parts should be stored inline in normal message history. That keeps refresh, reconnect, and detached/native modes consistent.

### Live updates

For streaming or in-place replacement, reuse the existing `agent` event channel instead of adding an unrelated top-level event. The current type model already allows custom agent streams via [`types/chat.ts`](../types/chat.ts).

Proposed stream:

```ts
payload.stream === "plugin"
```

Proposed payload shapes:

```ts
type PluginAgentEventData =
  | {
      phase: "mount";
      part: PluginContentPart;
      index?: number;           // optional explicit insertion index
    }
  | {
      phase: "replace";
      partId: string;
      state: PluginState;
      data: unknown;
      revision?: number;
    }
  | {
      phase: "remove";
      partId: string;
      tombstone?: boolean;      // true => keep part, set state=tombstone
      revision?: number;
    };
```

Why `agent.stream = "plugin"` instead of `event: "canvas_update"`:

- it fits the current WebSocket event architecture
- it is already keyed by `runId` and timestamp
- it keeps all assistant run updates on one channel
- it avoids widening the top-level event union unless there is a real cross-run need

### Message targeting

For live runs, the target message is the assistant message associated with `runId`.

For history and reconnect, the message must preserve a stable server identity instead of synthetic `hist-*` ids wherever possible. This requires updating [`lib/chat/historyResponse.ts`](../lib/chat/historyResponse.ts) to prefer server-provided ids or run ids when present.

Without stable ids, a reconnecting client cannot reliably match future plugin updates to an existing message.

---

## Store Mutations

Add plugin-aware mutation helpers beside the existing stream mutation helpers in [`lib/chat/streamMutations.ts`](../lib/chat/streamMutations.ts).

Suggested API:

```ts
export function mountPluginPart(
  messages: Message[],
  runId: string,
  part: PluginContentPart,
  ts: number,
  index?: number,
): EnsureResult;

export function replacePluginPart(
  messages: Message[],
  runId: string,
  partId: string,
  next: Pick<PluginContentPart, "state" | "data" | "revision">,
): Message[];

export function removePluginPart(
  messages: Message[],
  runId: string,
  partId: string,
  tombstone?: boolean,
): Message[];
```

Revision handling rule:

- if incoming `revision` is absent, apply the update
- if incoming `revision` is present and older than the current one, ignore it

This prevents out-of-order plugin frames from rolling the UI backward.

---

## Streaming Order Fix Required

This plugin system exposes an existing weakness in the current stream append logic.

Today, `appendContentDelta()` merges into the most recent text part unless a later tool call exists. That is too narrow. Once plugins become ordered content parts, a plugin card should also act as a boundary between text segments.

Required rule:

- text deltas may merge only into the latest trailing text part
- if any later structural part exists, append a new text part instead

Structural parts should include at least:

- `tool_call`
- `toolCall`
- `thinking`
- `plugin`
- possibly `image`, `image_url`, and `file` if the server can interleave text after them

The same principle applies to thinking segments.

Without this change, text emitted after a plugin could be merged into text before the plugin, breaking chronology in the thread.

---

## Host-Managed Actions

Interactive plugins should not execute transport logic directly. Instead, they ask the host to perform a named action.

Action descriptor:

```ts
export interface PluginAction {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "destructive";
  request: {
    kind: "http";
    method: "POST";
    url: string;
    body?: Record<string, unknown>;
    fireAndForget?: boolean;
  } | {
    kind: "ws";
    method: string;
    params?: Record<string, unknown>;
  };
}
```

Interactive plugin payloads may embed actions in their validated `data`.

The plugin host exposes:

```ts
invokeAction(action: PluginAction, input?: Record<string, unknown>): Promise<void>
```

The host is responsible for:

- disabling duplicate submissions
- surfacing recoverable action errors
- preserving native/detached behavior
- applying any optimistic local state only when explicitly desired

This keeps network behavior centralized and testable.

---

## Built-In Plugins

The first two built-ins map directly from the canvas spec.

### `status_card`

Validated data:

```ts
type StatusCardData = {
  label: string;
  status: "pending" | "running" | "succeeded" | "failed" | "stopped";
  startedAt?: number;
  duration?: number;
  detail?: string;
}
```

Behavior:

- `pending`: skeleton or spinner
- `active`: live timer and animated status
- `settled`: terminal state and duration
- `tombstone`: neutral unavailable card

### `pause_card`

Validated data:

```ts
type PauseCardData = {
  prompt: string;
  options: Array<{
    id: string;
    label: string;
    value: string;
    style?: "primary" | "secondary" | "destructive";
  }>;
  actions: PluginAction[];
  expiresAt?: number;
}
```

Behavior:

- renders a prompt and options inline in the thread
- disables repeated taps immediately after selection
- calls `invokeAction()`
- shows retry affordance if the host action fails
- settles when the server sends the next plugin update or follow-up message

This is the only built-in plugin that should accept user input initially.

---

## Input Attachment Plugins

The message plugin system extends the assistant rendering pipeline. Input attachment plugins extend the **compose** pipeline — they define new kinds of content that the user can attach to the input bar before sending a message.

### Motivation

The compose input supports image, file, and quote attachments. Each kind needs:

- a preview chip in the attachment strip
- a send-time conversion into the outgoing message payload
- optional cleanup when the attachment is removed or the component unmounts

Without a plugin system, adding a new attachment kind requires touching ChatInput rendering, the submit function, and the cleanup effect. Input attachment plugins localize all three concerns into one object, matching the message plugin pattern.

### Interface

```ts
// lib/plugins/inputAttachmentTypes.ts

export interface InputAttachmentPreviewProps<TData = unknown> {
  data: TData;
  onRemove: () => void;
  onLightbox?: (src: string) => void;
}

export interface InputAttachmentSendContribution {
  textPrefix?: string;         // prepended to message text
  images?: ImageAttachment[];  // appended to the image attachment array
}

export interface InputAttachmentPlugin<TData = unknown> {
  kind: string;
  renderPreview: (props: InputAttachmentPreviewProps<TData>) => ReactNode;
  toSendContribution: (data: TData) => InputAttachmentSendContribution;
  cleanup?: (data: TData) => void;
}
```

Each plugin is keyed by a `kind` string, analogous to the message plugin's `type`.

### Storage Model

Attachments are stored as generic envelopes:

```ts
// types/chat.ts

export interface InputAttachment {
  kind: string;
  data: unknown;
}
```

The `data` field is opaque at the type level. The plugin's `renderPreview` and `toSendContribution` functions cast it to their typed payload, following the same pattern as message plugins where `parse()` validates `data` before `render()` uses it.

### Registry

```ts
// lib/plugins/inputAttachmentRegistry.ts

export const inputAttachmentRegistry = {
  get(kind: string): AnyInputAttachmentPlugin | undefined;
  list(): AnyInputAttachmentPlugin[];
};
```

The registry merges built-in plugins from `lib/plugins/inputAttachmentBuiltins.tsx` with app-level plugins from `plugins/app/index.ts`, the same pattern as the message plugin registry.

### Built-In Kinds

Three input attachment kinds ship as built-ins:

| Kind    | Preview                          | Send contribution                                | Cleanup            |
|---------|----------------------------------|--------------------------------------------------|--------------------|
| `image` | Thumbnail with lightbox click    | `{ images: [ImageAttachment] }`                  | Revokes object URL |
| `file`  | File icon + truncated name       | `{ images: [ImageAttachment] }`                  | Revokes object URL |
| `quote` | Quote icon + truncated text      | `{ textPrefix: "> line1\n> line2" }`             | None               |

### Hook

The `useInputAttachments` hook manages the attachment list:

```ts
const {
  attachments,            // InputAttachment[]
  add,                    // (kind: string, data: unknown) => void
  addFiles,               // (files: FileList | File[]) => void
  addQuote,               // (text: string) => void
  removeAttachment,       // (index: number) => void
  clearAll,               // () => void
} = useInputAttachments();
```

- `add(kind, data)` is the generic entry point for plugin-provided kinds
- `addFiles` and `addQuote` are convenience wrappers for built-in kinds
- `removeAttachment` and `clearAll` call each plugin's `cleanup` function
- The hook revokes resources on unmount via the registry's `cleanup` methods

### Rendering

`ChatInput` iterates the attachment list and delegates each item's preview to the registry:

```tsx
{attachments.map((att, i) => {
  const plugin = inputAttachmentRegistry.get(att.kind);
  if (!plugin) return null;
  return plugin.renderPreview({
    data: att.data,
    onRemove: () => onRemoveAttachment(i),
    onLightbox: setLightboxSrc,
  });
})}
```

Unknown kinds are silently skipped. This matches the message plugin system's graceful fallback principle — missing renderers never crash the compose area.

### Send Flow

On submit, `ChatInput` collects contributions from all attachments via the registry:

```ts
const allImages: ImageAttachment[] = [];
const textPrefixes: string[] = [];

for (const att of attachments) {
  const plugin = inputAttachmentRegistry.get(att.kind);
  if (!plugin) continue;
  const c = plugin.toSendContribution(att.data);
  if (c.textPrefix) textPrefixes.push(c.textPrefix);
  if (c.images) allImages.push(...c.images);
}

const prefix = textPrefixes.join("\n\n");
const full = prefix ? (text ? `${prefix}\n\n\n${text}` : prefix) : text;
onSend(full, allImages.length > 0 ? allImages : undefined);
```

The downstream `onSend(text, ImageAttachment[])` signature is unchanged. Input attachment plugins influence the message through `textPrefix` and `images`, not by modifying the transport.

### Adding A Custom Kind

To add a new input attachment kind, add a plugin to `plugins/app/index.ts`:

```ts
import type { AnyInputAttachmentPlugin } from "@mc/lib/plugins/inputAttachmentTypes";

export const appInputAttachmentPlugins: AnyInputAttachmentPlugin[] = [
  {
    kind: "location",
    renderPreview: ({ data, onRemove }) => (
      <div className="relative shrink-0 h-10 flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5">
        <span className="text-xs text-muted-foreground">{data.name}</span>
        <button type="button" onClick={onRemove} className="...">×</button>
      </div>
    ),
    toSendContribution: (data) => ({
      textPrefix: `📍 ${data.name} (${data.lat}, ${data.lng})`,
    }),
  },
];
```

Then trigger it from application code:

```ts
const { add } = useInputAttachments();
add("location", { name: "Office", lat: 37.77, lng: -122.42 });
```

### File Layout

```text
lib/plugins/
  inputAttachmentTypes.ts       # plugin interface
  inputAttachmentBuiltins.tsx   # image, file, quote plugins
  inputAttachmentRegistry.ts    # registry combining builtins + app plugins

hooks/chat/
  useInputAttachments.ts        # state management hook

plugins/app/
  index.ts                      # exports appInputAttachmentPlugins[]
```

### Relationship To Message Plugins

Input attachment plugins and message plugins are independent extension points:

- **Message plugins** extend the assistant rendering pipeline (server-driven, inside `content` parts)
- **Input attachment plugins** extend the compose pipeline (client-driven, inside the input bar)

They share the same structural patterns — `kind`/`type` discriminator, build-time registry, graceful fallback — but do not reference each other. A message plugin cannot inject an input attachment, and an input attachment plugin does not render inside the message thread.

---

## Compatibility With The Canvas Spec

If the backend already emits the proposed top-level `canvas` field, MobileClaw can support a compatibility adapter during rollout.

Normalization rule:

```ts
message.canvas -> append a synthetic { type: "plugin", pluginType, ... } content part
```

Compatibility update rule:

```ts
canvas_update -> translate to replacePluginPart(...)
```

This allows the backend to move first without forcing the client to permanently own two rendering systems.

The compatibility layer should be temporary. The target steady state is a single content-part model.

---

## Security And Reliability Constraints

### Security

- no runtime JS loading from message payloads
- no `dangerouslySetInnerHTML` from plugin data
- no unrestricted plugin-owned network calls
- validate every payload before render

### Reliability

- unknown types render fallback
- invalid data renders fallback
- stale revisions are ignored
- history messages store plugin parts inline
- message ids stay stable across reconnects

### UX

- plugins must render all lifecycle states
- plugins must be mobile-first and work in native wrapper mode
- plugins should remain visually subordinate to the conversation, not dominate the viewport

---

## Testing Strategy

Unit tests should cover:

- plugin registry lookup
- unknown/invalid fallback rendering
- plugin payload parsing
- plugin store mutations
- out-of-order revision rejection
- action invocation success and failure
- history replay containing plugin parts

Integration tests should cover:

- text before plugin, plugin update in place, text after plugin
- reconnect with existing plugin content in history
- `pause_card` submission and retry behavior
- detached mode rendering
- native mode rendering

---

## Implementation Touchpoints

The current codebase can absorb this with localized changes:

- [`types/chat.ts`](../types/chat.ts): add `plugin` part and plugin state/types
- [`components/MessageRow.tsx`](../components/MessageRow.tsx): add plugin-part rendering branch
- [`lib/chat/streamMutations.ts`](../lib/chat/streamMutations.ts): add plugin mutation helpers and structural-boundary-aware text/thinking append logic
- [`hooks/chat/useOpenClawRuntime.ts`](../hooks/chat/useOpenClawRuntime.ts): handle `payload.stream === "plugin"`
- [`lib/chat/historyResponse.ts`](../lib/chat/historyResponse.ts): preserve stable message ids and retain plugin parts in history
- [`lib/messageUtils.ts`](../lib/messageUtils.ts): keep text/image/file helpers ignoring plugin parts unless explicitly requested

---

## Rollout Plan

### Phase 1

- add `plugin` content part type
- add registry and fallback renderer
- render built-in `status_card` from static history content

### Phase 2

- add plugin stream mutations
- handle `agent.stream = "plugin"`
- preserve stable server message ids in history

### Phase 3

- add host-managed actions
- ship `pause_card`

### Phase 4

- document app-level plugin registration
- add one sample application-specific plugin in `plugins/app/`

---

## Decision

MobileClaw should adopt a build-time plugin system, but the plugin boundary should be a new `plugin` content part inside the existing message model, not a top-level `message.canvas` field.

That gives the project the same product outcome as the canvas spec, while staying aligned with:

- the current rendering pipeline
- the current history model
- the current stream mutation architecture
- MobileClaw's mobile-first reliability constraints
