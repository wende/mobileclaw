"use client";

import type { ContentPart } from "@/types/chat";

export function ImageThumbnails({ images }: { images: ContentPart[] }) {
  if (images.length === 0) return null;
  return (
    <div className="mt-1.5 flex gap-1.5 flex-wrap">
      {images.map((img, i) => {
        const src = img.type === "image_url" ? img.image_url?.url : undefined;
        return (
          <div key={i} className="h-16 w-16 overflow-hidden rounded-lg border border-border bg-secondary">
            {src ? (
              <img src={src || "/placeholder.svg"} alt="Attached" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
                  <rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
