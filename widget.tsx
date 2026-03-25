"use client"

import { forwardRef, useMemo } from "react"
import "./app/globals.css"
import Home from "./app/page"
import { WidgetContextProvider } from "./lib/widgetContext"
import type { ChatInputHandle } from "./components/ChatInput"

export type { ChatInputHandle }

export interface ChatWidgetProps {
  wsUrl?: string
  className?: string
  demo?: boolean
  transparentHostBackground?: boolean
}

export const ChatWidget = forwardRef<ChatInputHandle, ChatWidgetProps>(
  function ChatWidget({ wsUrl, className, demo, transparentHostBackground = true }, ref) {
    const rootClassName = className ? `bg-background ${className}` : "bg-background"
    const modeValue = useMemo(
      () => ({
        isDetached: true,
        noBorder: true,
        wsUrl: wsUrl ?? null,
        demo: demo ?? false,
        transparentHostBackground,
      }),
      [wsUrl, demo, transparentHostBackground],
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
