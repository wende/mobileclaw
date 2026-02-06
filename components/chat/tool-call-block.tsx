"use client";

import { useState } from "react";
import { ChevronRight, Terminal, Check, X, Loader2 } from "lucide-react";
import type { ToolEvent } from "@/lib/chat-types";

export function ToolCallBlock({
  name,
  args,
  status = "success",
}: {
  name: string;
  args?: string;
  status?: ToolEvent["status"];
}) {
  const [expanded, setExpanded] = useState(false);

  let parsedArgs: Record<string, unknown> | null = null;
  try {
    parsedArgs = args ? JSON.parse(args) : null;
  } catch {
    parsedArgs = null;
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border transition-colors">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-secondary/50"
        type="button"
      >
        <div className="flex h-5 w-5 items-center justify-center">
          {status === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : status === "success" ? (
            <Check className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <X className="h-3.5 w-3.5 text-destructive" />
          )}
        </div>
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 font-mono text-xs text-foreground">
          {name}
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      <div
        className="grid transition-all duration-200 ease-out"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
          {parsedArgs && (
            <div className="border-t border-border bg-secondary/30 px-3.5 py-3">
              <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-muted-foreground">
                {JSON.stringify(parsedArgs, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ToolResultBlock({
  name,
  text,
  isError,
}: {
  name: string;
  text: string;
  isError?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`my-2 overflow-hidden rounded-lg border transition-colors ${
        isError ? "border-destructive/30" : "border-border"
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-secondary/50"
        type="button"
      >
        <div className="flex h-5 w-5 items-center justify-center">
          {isError ? (
            <X className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <Check className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 font-mono text-xs text-foreground">
          {name} result
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      <div
        className="grid transition-all duration-200 ease-out"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border bg-secondary/30 px-3.5 py-3">
            <pre
              className={`overflow-x-auto font-mono text-xs leading-relaxed ${
                isError
                  ? "text-destructive-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {text}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
