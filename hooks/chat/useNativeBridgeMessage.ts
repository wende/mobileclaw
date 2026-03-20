import { useCallback } from "react";

import { PIN_LOCK_MS } from "@mc/hooks/useScrollManager";
import { resolveIdentitySign, type BridgeMessage } from "@mc/lib/nativeBridge";
import type { BackendMode, ConnectionConfig, Message } from "@mc/types/chat";

interface UseNativeBridgeMessageOptions {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  pinnedToBottomRef: React.MutableRefObject<boolean>;
  pinLockUntilRef: React.MutableRefObject<number>;
  setZenModeEnabled: (enabled: boolean) => void;
  scrollToBottom: () => void;
  // Phase 1: Config bridge — web handles its own connection
  handleConnect: (config: ConnectionConfig) => void;
  // Phase 3: Actions from native UI
  onNativeSend: (text: string) => void;
  onNativeAbort: () => void;
  onNativeSessionSelect: (key: string) => void;
  onNativeRequestHistory: () => void;
  onNativeRequestSessionsList: () => void;
}

export function useNativeBridgeMessage({
  setMessages,
  pinnedToBottomRef,
  pinLockUntilRef,
  setZenModeEnabled,
  scrollToBottom,
  handleConnect,
  onNativeSend,
  onNativeAbort,
  onNativeSessionSelect,
  onNativeRequestHistory,
  onNativeRequestSessionsList,
}: UseNativeBridgeMessageOptions) {
  return useCallback((msg: BridgeMessage) => {
    switch (msg.type) {
      // Phase 0: Identity signing response from Swift
      case "identity:signResponse": {
        resolveIdentitySign(msg.payload as Record<string, unknown>);
        break;
      }

      // Phase 1: Config bridge — Swift tells web to connect
      case "config:connection": {
        const p = msg.payload as { mode: string; url: string; token?: string; model?: string };
        handleConnect({
          mode: p.mode as BackendMode,
          url: p.url,
          token: p.token,
          model: p.model,
          remember: false,
        });
        break;
      }

      // Phase 3: Actions from native UI routed through web protocol stack
      case "action:send": {
        const p = msg.payload as { text: string };
        onNativeSend(p.text);
        break;
      }
      case "action:abort": {
        onNativeAbort();
        break;
      }
      case "action:switchSession": {
        const p = msg.payload as { key: string };
        onNativeSessionSelect(p.key);
        break;
      }
      case "action:requestHistory": {
        onNativeRequestHistory();
        break;
      }
      case "action:requestSessionsList": {
        onNativeRequestSessionsList();
        break;
      }

      // Optimistic user message from native input bar
      case "messages:append": {
        const newMsg = msg.payload as Message;
        pinnedToBottomRef.current = true;
        pinLockUntilRef.current = Date.now() + PIN_LOCK_MS;
        setMessages((prev) => [...prev, newMsg]);
        break;
      }

      // UI commands from Swift
      case "theme:set": {
        const { theme: newTheme } = msg.payload as { theme: "light" | "dark" };
        const html = document.documentElement;
        if (newTheme === "dark") html.classList.add("dark");
        else html.classList.remove("dark");
        break;
      }
      case "zen:set": {
        const { enabled } = (msg.payload ?? {}) as { enabled?: unknown };
        if (typeof enabled === "boolean") {
          setZenModeEnabled(enabled);
        }
        break;
      }
      case "scroll:toBottom":
        scrollToBottom();
        break;
    }
  }, [
    handleConnect,
    onNativeAbort,
    onNativeRequestHistory,
    onNativeRequestSessionsList,
    onNativeSessionSelect,
    onNativeSend,
    pinLockUntilRef,
    pinnedToBottomRef,
    scrollToBottom,
    setMessages,
    setZenModeEnabled,
  ]);
}
