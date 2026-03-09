"use client";

import { useState } from "react";
import type { UnfurlData } from "@/lib/unfurl";

export function LinkPreviewCard({ data }: { data: UnfurlData }) {
  const [imgError, setImgError] = useState(false);
  const showImage = !!data.image && !imgError;

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-2 no-underline transition-colors hover:bg-secondary"
    >
      {showImage && (
        <img
          src={data.image}
          alt=""
          onError={() => setImgError(true)}
          className="h-14 w-14 shrink-0 rounded-md object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        {data.title && (
          <p className="text-xs font-medium text-foreground line-clamp-2">{data.title}</p>
        )}
        {data.description && (
          <p className="mt-0.5 text-2xs text-muted-foreground line-clamp-2">{data.description}</p>
        )}
        <div className="mt-1 flex items-center gap-1">
          {data.favicon ? (
            <img src={data.favicon} alt="" className="h-3 w-3 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          )}
          <span className="text-2xs text-muted-foreground">{data.domain}</span>
        </div>
      </div>
    </a>
  );
}

export function LinkPreviewSkeleton() {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-2 animate-pulse">
      <div className="h-14 w-14 shrink-0 rounded-md bg-secondary" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-3/4 rounded bg-secondary" />
        <div className="h-2.5 w-1/2 rounded bg-secondary" />
        <div className="h-2 w-1/4 rounded bg-secondary" />
      </div>
    </div>
  );
}
