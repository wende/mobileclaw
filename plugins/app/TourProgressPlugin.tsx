"use client";

import { z } from "zod";

import type {
  MobileClawPlugin,
  PluginParseResult,
  PluginViewProps,
} from "@/lib/plugins/types";

const tourProgressSchema = z.object({
  step: z.number(),
  total: z.number(),
  label: z.string(),
});

type TourProgressData = z.infer<typeof tourProgressSchema>;

function toParseResult<T>(
  result: z.SafeParseReturnType<unknown, T>,
): PluginParseResult<T> {
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues[0]?.message || "Invalid plugin payload",
  };
}

function TourProgressView({
  state,
  data,
  invokeAction,
}: PluginViewProps<TourProgressData>) {
  const isSettled = state === "settled";
  const isComplete = isSettled && data.step >= data.total;
  const progress = Math.round((data.step / data.total) * 100);

  return (
    <div
      data-testid="tour-progress"
      className="rounded-2xl border border-border bg-card/80 px-3.5 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-primary">
            Tour
          </span>
          <span className="text-sm font-medium text-foreground truncate">
            {data.label}
          </span>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {data.step}/{data.total}
          </span>
        </div>
        {!isSettled && (
          <button
            type="button"
            onClick={() =>
              invokeAction(
                {
                  id: "skip-tour",
                  label: "Skip",
                  request: {
                    kind: "ws",
                    method: "pause.respond",
                    params: { partId: "tour-skip" },
                  },
                },
                { selectedLabel: "Skip", selectedValue: "skip" },
              )
            }
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip tour
          </button>
        )}
      </div>
      <div className="mt-2 h-1 w-full rounded-full bg-border/60 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            isComplete ? "bg-primary/60" : "bg-primary"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export const tourProgressPlugin: MobileClawPlugin<TourProgressData> = {
  type: "tour_progress",
  width: "chat",
  parse: (raw) => toParseResult(tourProgressSchema.safeParse(raw)),
  render: (props) => <TourProgressView {...props} />,
};
