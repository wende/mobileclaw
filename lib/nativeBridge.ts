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

// ── Identity signing (Phase 0) ───────────────────────────────────────────────

type IdentitySignResult = {
  deviceId: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
};

const pendingIdentityCallbacks = new Map<string, {
  resolve: (result: IdentitySignResult) => void;
  reject: (err: Error) => void;
}>();

let identityCallbackCounter = 0;

/**
 * Ask the native shell to sign a connect challenge using Keychain-stored keys.
 * Returns the signed device payload without exposing the private key to JS.
 */
export function requestNativeIdentitySign(
  nonce: string,
  token: string | null,
): Promise<IdentitySignResult> {
  const callbackId = `idcb-${++identityCallbackCounter}-${Date.now()}`;
  return new Promise((resolve, reject) => {
    pendingIdentityCallbacks.set(callbackId, { resolve, reject });
    postToNative({
      type: "identity:sign",
      payload: { nonce, token, callbackId },
    });
    // Timeout after 5s
    setTimeout(() => {
      if (pendingIdentityCallbacks.has(callbackId)) {
        pendingIdentityCallbacks.delete(callbackId);
        reject(new Error("Native identity sign timed out"));
      }
    }, 5000);
  });
}

/** Resolve a pending identity sign callback (called from bridge handler). */
export function resolveIdentitySign(payload: Record<string, unknown>) {
  const callbackId = payload.callbackId as string;
  const pending = pendingIdentityCallbacks.get(callbackId);
  if (!pending) return;
  pendingIdentityCallbacks.delete(callbackId);
  pending.resolve({
    deviceId: payload.deviceId as string,
    publicKey: payload.publicKey as string,
    signature: payload.signature as string,
    signedAt: payload.signedAt as number,
    nonce: payload.nonce as string,
  });
}

// ── State posting (Phase 2) ──────────────────────────────────────────────────

export function postConnectionState(state: string) {
  postToNative({ type: "state:connection", payload: { state } });
}

export function postRunState(isActive: boolean, isStreaming: boolean) {
  postToNative({ type: "state:run", payload: { isActive, isStreaming } });
}

export function postModelState(model: string | null) {
  postToNative({ type: "state:model", payload: { model } });
}

export function postSessionsState(sessions: unknown[], currentKey: string | null | undefined) {
  postToNative({ type: "state:sessions", payload: { sessions, currentKey } });
}

// ── Action posting (Phase 3) ─────────────────────────────────────────────────

export function postActionSend(text: string) {
  postToNative({ type: "action:send", payload: { text } });
}

export function postActionAbort() {
  postToNative({ type: "action:abort" });
}

export function postActionSwitchSession(key: string) {
  postToNative({ type: "action:switchSession", payload: { key } });
}

export function postActionRequestHistory() {
  postToNative({ type: "action:requestHistory" });
}

export function postActionRequestSessionsList() {
  postToNative({ type: "action:requestSessionsList" });
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
