"use client";

export function ThinkingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="text-sm text-muted-foreground flex items-center gap-1">
        <span>Thinking</span>
        <span className="inline-flex w-5">
          <span className="animate-[dotFade_1.4s_ease-in-out_infinite]">.</span>
          <span className="animate-[dotFade_1.4s_ease-in-out_0.2s_infinite]">.</span>
          <span className="animate-[dotFade_1.4s_ease-in-out_0.4s_infinite]">.</span>
        </span>
      </div>
    </div>
  );
}
