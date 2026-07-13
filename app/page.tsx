"use client";

import { ChatHome } from "./ChatHome";

// A Next.js route page cannot be a forwardRef component (pages never receive a
// ref). The ref-exposing implementation lives in ./ChatHome (also consumed by
// widget.tsx); this route just renders it as a plain page.
export default function Page() {
  return <ChatHome />;
}
