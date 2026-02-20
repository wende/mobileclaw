# UI Polish: Animations, Tool Pill Improvements, and Streaming UX

**Date:** 2026-02-20
**Commit:** `2b5578e`
**Files:** `components/SmoothGrow.tsx` (new), `components/MessageRow.tsx`, `components/ToolCallPill.tsx`, `components/SubagentActivityFeed.tsx`, `lib/demoMode.ts`, `lib/toolDisplay.ts`, `app/globals.css`

## Summary

Batch of UX polish: smooth height transitions during streaming, slide-in animations for thinking blocks and tool pills, improved edit/read tool displays, and a new "edit" demo keyword.

## Smooth Streaming Height — `SmoothGrow`

New component that wraps assistant message content. Uses `ResizeObserver` to detect content height changes as streaming text wraps to new lines, then applies `transition: height 120ms ease-out`.

Key decisions:
- **No `overflow: hidden`** — clipped new text at the bottom during the height transition. Removing it means content is always visible; the `height` property still drives layout flow so the chat scroll area grows smoothly.
- **Stable DOM structure** — always renders the same outer+inner div pair regardless of `active` prop. An earlier version conditionally rendered different structures, which caused React to remount children when streaming ended (re-triggering edit pill mount animations).

## Slide Animations — CSS Grid Trick

All expandable elements (tool pills, spawn pills, thinking blocks) use the same pattern:

```css
grid-template-rows: 0fr → 1fr  /* with transition */
overflow: hidden; min-h-0;     /* on inner child */
```

Mount animation uses `requestAnimationFrame` to ensure the browser paints the collapsed `0fr` state before transitioning:

```tsx
const [open, setOpen] = useState(false);
useEffect(() => {
  const raf = requestAnimationFrame(() => setOpen(true));
  return () => cancelAnimationFrame(raf);
}, []);
```

## ThinkingPill Rewrite

Replaced `<details>` with button + state + grid animation. Two separate states to avoid the pill disappearing entirely on collapse:

- `mounted` — outer slide-in, only goes `false → true` once on mount
- `expanded` — inner content toggle, controlled by user click

## Tool Pill Changes

**Edit tool** (`name === "edit" | "file_edit" | "editFile"`):
- Title: bold "edit" + truncated file path
- Auto-expands on mount with slide animation
- Arguments section shows inline diff only (no file path subtitle — redundant with title)
- Result section hidden entirely

**Read tool** (`name === "read" | "readFile" | "read_file"`):
- Title: bold "read" + truncated file path
- Arguments section hidden (path already in title)
- Result section shown on expand

**Icon fix**: `<StatusIcon />` is a JSX element, which is always truthy. `statusEl || toolIconEl` always picked `statusEl` even when `StatusIcon` returned `null` at runtime. Fixed by checking `status === "running" || resultError` before choosing which icon component to render.

## Demo Mode

Added "edit" / "fix" / "patch" / "diff" keyword that demonstrates:
1. A `read` tool call (reading auth middleware)
2. An `edit` tool call with inline diff (fixing Bearer token extraction)
3. Explanation text

## Other

- `scrollbar-hide` Tailwind v4 utility (`@utility` in `globals.css`) applied to subagent activity feed
- `toolDisplay.ts` — edit/read cases return just the path; bold label prefix handled in pill rendering
