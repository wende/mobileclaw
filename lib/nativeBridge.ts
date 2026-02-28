// Native bridge for Swift <-> Web communication
// Swift calls: window.__bridge.receive(msg)
// Web calls: window.webkit.messageHandlers.bridge.postMessage(msg)

export interface BridgeMessage {
  type: string;
  payload?: unknown;
}

type BridgeHandler = (msg: BridgeMessage) => void;

let handler: BridgeHandler | null = null;

/** Check if we're running inside the native iOS shell. */
export function isNativeMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("native") !== null
    || (window as any).__nativeMode === true;
}

/** Register a handler for messages from Swift. */
export function registerBridgeHandler(fn: BridgeHandler) {
  handler = fn;
  // Expose the receiver on window for Swift's evaluateJavaScript.
  // Only create the bridge object once; handler updates take effect
  // automatically since receive() reads the module-level `handler` var.
  if (!(window as any).__bridge) {
    (window as any).__bridge = {
      receive(msg: BridgeMessage | string) {
        const parsed = typeof msg === "string" ? JSON.parse(msg) : msg;
        handler?.(parsed);
      },
    };
  }
}

/** Update the bridge handler without re-creating the bridge object. */
export function updateBridgeHandler(fn: BridgeHandler) {
  handler = fn;
}

/** Send a message from Web to Swift. */
export function postToNative(msg: BridgeMessage) {
  try {
    (window as any).webkit?.messageHandlers?.bridge?.postMessage(msg);
  } catch {
    // Not in native context — silently ignore
  }
}

/** Notify Swift that the web view is ready to receive messages. */
export function notifyWebViewReady() {
  postToNative({ type: "webview:ready" });
}

// ── Outbound helpers (Web → Swift) ────────────────────────────────────────────

export function postScrollPosition(distanceFromBottom: number) {
  postToNative({ type: "scroll:position", payload: { distanceFromBottom } });
}

export function postTextSelected(text: string, x: number, y: number) {
  postToNative({ type: "text:selected", payload: { text, x, y } });
}

export function postTextDeselected() {
  postToNative({ type: "text:deselected" });
}

export function postLinkTap(url: string) {
  postToNative({ type: "link:tap", payload: { url } });
}

export function postImageTap(src: string) {
  postToNative({ type: "image:tap", payload: { src } });
}

export function postSubagentPin(toolCallId: string, childSessionKey: string | null, taskName: string) {
  postToNative({ type: "subagent:pin", payload: { toolCallId, childSessionKey, taskName } });
}

export function postSubagentUnpin() {
  postToNative({ type: "subagent:unpin" });
}
