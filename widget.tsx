"use client"

import { forwardRef, useMemo } from "react"
import "./app/globals.css"
import Home from "./app/page"
import { WidgetContextProvider } from "./lib/widgetContext"
import type { ChatInputHandle } from "./components/ChatInput"

export type { ChatInputHandle }

export interface ChatWidgetProps {
  wsUrl?: string
  token?: string | null
  className?: string
  demo?: boolean
  transparentHostBackground?: boolean
  onSessionsChange?: (sessions: import("@mc/types/chat").SessionInfo[], currentKey: string, loading: boolean) => void
  /** Called when the gateway rejects with DEVICE_AUTH_SIGNATURE_INVALID.
   *  Return a fresh gateway auth token (or null) to retry. */
  onTokenRefresh?: () => Promise<string | null>
}

export const ChatWidget = forwardRef<ChatInputHandle, ChatWidgetProps>(
  function ChatWidget({ wsUrl, token, className, demo, transparentHostBackground = true, onSessionsChange, onTokenRefresh }, ref) {
    const rootClassName = className ? `bg-background ${className}` : "bg-background"
    const modeValue = useMemo(
      () => ({
        isDetached: true,
        noBorder: true,
        wsUrl: wsUrl ?? null,
        token: token ?? null,
        demo: demo ?? false,
        transparentHostBackground,
        onSessionsChange,
        onTokenRefresh,
      }),
      [wsUrl, token, demo, transparentHostBackground, onSessionsChange, onTokenRefresh],
    )

    return (
      <div className={rootClassName} data-mobileclaw-embedded>
        <WidgetContextProvider value={modeValue}>
          <Home ref={ref} />
        </WidgetContextProvider>
      </div>
    )
  },
)
