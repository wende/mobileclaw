"use client"

import { useMemo } from "react"
import "./app/globals.css"
import Home from "./app/page"
import { WidgetContextProvider } from "./lib/widgetContext"

export interface ChatWidgetProps {
  wsUrl?: string
  className?: string
}

export function ChatWidget({ wsUrl, className }: ChatWidgetProps) {
  const modeValue = useMemo(
    () => ({ isDetached: true, noBorder: true, wsUrl: wsUrl ?? null }),
    [wsUrl],
  )

  return (
    <div className={className} data-mobileclaw-embedded>
      <WidgetContextProvider value={modeValue}>
        <Home />
      </WidgetContextProvider>
    </div>
  )
}
