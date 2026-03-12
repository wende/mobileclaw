"use client";

export function InvalidPluginCard({ pluginType }: { pluginType: string }) {
  return (
    <div
      data-testid="invalid-plugin-card"
      className="rounded-2xl border border-border bg-card/60 px-3.5 py-3 text-xs text-muted-foreground"
    >
      <div className="font-medium text-foreground/80">Widget data unavailable</div>
      <div className="mt-1 break-all">{pluginType}</div>
    </div>
  );
}
