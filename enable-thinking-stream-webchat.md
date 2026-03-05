# Patch: Enable thinking stream for webchat (`chat.send`)

## What this does

Adds a no-op `onReasoningStream` callback to the `chat.send` handler's `replyOptions`.
This unblocks the `typeof params.onReasoningStream === "function"` gate in the agent
subscribe layer, allowing `stream: "thinking"` WebSocket events to be emitted for
webchat runs.

No chat payload shapes are changed. No other behavior is altered.

## Prerequisites

- The session's reasoning level must be set to `stream` (via session config or
  the `/think stream` command in chat) — otherwise no thinking events are produced
  even with this patch applied.

## Step 1: Find the file

The target is the **gateway-cli** chunk inside the globally installed openclaw dist.
The filename contains a hash that changes between versions.

```bash
# Find the openclaw dist directory
DIST="$(dirname "$(readlink -f "$(which openclaw)")")/dist"

# There will be one or two gateway-cli-*.js files
ls "$DIST"/gateway-cli-*.js
```

Example output:
```
/opt/homebrew/lib/node_modules/openclaw/dist/gateway-cli-C7FS-lL-.js
/opt/homebrew/lib/node_modules/openclaw/dist/gateway-cli-tzSO700C.js
```

**Patch ALL `gateway-cli-*.js` files** — both may be loaded depending on the entry
point.

## Step 2: Find the exact line

Search for `onModelSelected` inside the `replyOptions` block of the `chat.send`
handler. The surrounding context looks like this:

```bash
grep -n 'onModelSelected' "$DIST"/gateway-cli-*.js
```

You're looking for a match that sits inside a `replyOptions: {` block, right before
a closing `}` followed by `}).then(() => {`. The full context:

```js
				replyOptions: {
					runId: clientRunId,
					abortSignal: abortController.signal,
					images: parsedImages.length > 0 ? parsedImages : void 0,
					onAgentRunStart: (runId) => {
						// ... several lines ...
					},
					onModelSelected           // <-- THIS LINE
				}                              // <-- closing replyOptions
			}).then(() => {
```

To confirm you have the right spot:
```bash
grep -n -A2 'onModelSelected$' "$DIST"/gateway-cli-*.js
```

Expected output (line numbers will vary):
```
10856:					onModelSelected
10857-				}
10858-			}).then(() => {
```

## Step 3: Apply the patch

Replace:
```js
					onModelSelected
				}
			}).then(() => {
				if (!agentRunStarted) {
```

With:
```js
					onModelSelected,
					onReasoningStream: async () => {}
				}
			}).then(() => {
				if (!agentRunStarted) {
```

**Changes:**
1. Add a comma after `onModelSelected`
2. Add the line `onReasoningStream: async () => {}`

### Using sed (apply to each gateway-cli file):

```bash
for f in "$DIST"/gateway-cli-*.js; do
  sed -i.bak 's/onModelSelected\n\t\t\t\t}/onModelSelected,\n\t\t\t\t\tonReasoningStream: async () => {}\n\t\t\t\t}/' "$f"
done
```

If sed doesn't handle the multiline match, use this per-file approach:

```bash
for f in "$DIST"/gateway-cli-*.js; do
  # Find the line number
  LINE=$(grep -n 'onModelSelected$' "$f" | head -1 | cut -d: -f1)
  if [ -n "$LINE" ]; then
    cp "$f" "$f.bak"
    sed -i '' "${LINE}s/onModelSelected/onModelSelected,\n\t\t\t\t\tonReasoningStream: async () => {}/" "$f"
    echo "Patched $f at line $LINE"
  else
    echo "SKIP $f — pattern not found"
  fi
done
```

## Step 4: Verify

```bash
grep -n 'onReasoningStream' "$DIST"/gateway-cli-*.js
```

Should show the new line in each patched file.

## Step 5: Restart the gateway

```bash
openclaw gateway restart
```

## Rollback

```bash
for f in "$DIST"/gateway-cli-*.js.bak; do
  mv "$f" "${f%.bak}"
done
openclaw gateway restart
```

## Caveat

This patch is overwritten on any `npm install -g openclaw` update.
