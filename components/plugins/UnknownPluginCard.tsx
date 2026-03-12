"use client";

export function UnknownPluginCard({ pluginType }: { pluginType: string }) {
  return (
    <div
      data-testid="unknown-plugin-card"
      className="rounded-2xl border border-dashed border-border bg-card/60 px-3.5 py-3 text-xs text-muted-foreground"
    >
      <div className="font-medium text-foreground/80">Unsupported widget</div>
      <div className="mt-1 break-all">{pluginType}</div>
    </div>
  );
}
