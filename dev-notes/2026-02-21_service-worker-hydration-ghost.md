# Service Worker Hydration Ghost — 2026-02-21

## Problem

After killing the dev server, the app still loaded on regular refresh but failed on hard refresh. Hydration mismatches kept appearing in `ChatHeader` where the git SHA span showed different values between server and client.

## Root Cause

The service worker (`public/sw.js`) was caching `/_next/static/` JS bundles with a **cache-first** strategy. When a new commit changed `NEXT_PUBLIC_GIT_SHA`, the server sent fresh HTML with the new SHA, but the service worker served the old cached JS bundle with the old SHA baked in. React compared them and threw hydration errors.

The SW also explained why the app kept "working" after killing the server — it served cached responses for everything.

## Why It Registered in Dev

The registration guard in `layout.tsx` is:
```js
if ('serviceWorker' in navigator && location.hostname !== 'localhost')
```

This prevents registration on `localhost:3000` but NOT on `127.0.0.1`, `0.0.0.0`, or LAN IPs. Once registered, the SW persists across page loads and browser restarts.

## Fix

Unregister the service worker: DevTools > Application > Service Workers > Unregister (or "Clear site data").

No code changes were needed for `ChatHeader.tsx` — the git SHA via `process.env.NEXT_PUBLIC_GIT_SHA` works fine without a stale SW cache.

## Other Fix: LocatorProvider

Separately, `@treelocator/runtime` was crashing on HMR because the static import's module factory got invalidated by Turbopack. Fixed by switching to a dynamic `import()` inside `useEffect`:

```tsx
// Before (crashes on HMR):
import setupLocatorUI from "@treelocator/runtime";

// After:
useEffect(() => {
  if (process.env.NODE_ENV === "development") {
    import("@treelocator/runtime").then((m) => m.default());
  }
}, []);
```

## Lesson

When debugging hydration mismatches, check for service workers first — they can serve stale JS bundles that don't match fresh server HTML. `suppressHydrationWarning`, state guards, and ref tricks won't help if the fundamental problem is the browser receiving mismatched HTML and JS from different points in time.
