"use client";

import { useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";

export function ThinkingBlock({ reasoning }: { reasoning: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-secondary/50"
        type="button"
      >
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 text-xs font-medium text-muted-foreground">
          Reasoning
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
            <p className="text-sm leading-relaxed text-muted-foreground italic">
              {reasoning}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
