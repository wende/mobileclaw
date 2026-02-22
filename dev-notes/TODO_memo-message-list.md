# TODO: Memoize message list to fix pointerdown violations

## Problem

Chrome flags `pointerdown` handlers taking ~200ms (threshold: 100ms). The `scheduler.development.js` `message` handler also takes 150-184ms.

Root cause: any click triggers a React re-render of the entire message list synchronously. Even though the click handler itself is trivial (`setOpen(v => !v)`), React processes the state update + full re-render within the same event handler tick.

Partially a dev-mode artifact (strict mode double-renders, extra checks), but will show up in production too with long conversations.

## Fix plan

1. **`React.memo(MessageRow)`** — biggest win. Only the clicked pill re-renders, not every message.
2. **Memoize `MarkdownContent` output** — re-parses markdown on every render currently.
3. **Virtualize the message list** — only render visible messages if conversations get long (react-window or similar). Bigger lift, do later.
