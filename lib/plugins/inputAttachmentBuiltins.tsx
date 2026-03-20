"use client";

import type { AnyInputAttachmentPlugin, InputAttachmentPlugin } from "@mc/lib/plugins/inputAttachmentTypes";

interface ImageData {
  mimeType: string;
  fileName: string;
  content: string;
  previewUrl: string;
}

interface FileData {
  mimeType: string;
  fileName: string;
  content: string;
  previewUrl: string;
}

interface QuoteData {
  text: string;
}

const DismissButton = ({ onClick, absolute }: { onClick: () => void; absolute?: boolean }) => (
  <button
    type="button"
    onClick={onClick}
    className={`${absolute ? "absolute -right-0.5 -top-0.5" : "shrink-0 rounded-full p-0.5"} flex h-4 w-4 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground transition-colors`}
  >
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  </button>
);

export const imageAttachmentPlugin: InputAttachmentPlugin<ImageData> = {
  kind: "image",
  renderPreview: ({ data, onRemove, onLightbox }) => (
    <div className="relative shrink-0 h-10 w-10 rounded-lg overflow-hidden border border-border bg-secondary">
      <img
        src={data.previewUrl}
        alt={data.fileName}
        className="h-full w-full object-cover cursor-pointer"
        onClick={() => onLightbox?.(data.previewUrl)}
      />
      <DismissButton onClick={onRemove} absolute />
    </div>
  ),
  toSendContribution: (data) => ({
    images: [{ mimeType: data.mimeType, fileName: data.fileName, content: data.content, previewUrl: data.previewUrl }],
  }),
  cleanup: (data) => URL.revokeObjectURL(data.previewUrl),
};

export const fileAttachmentPlugin: InputAttachmentPlugin<FileData> = {
  kind: "file",
  renderPreview: ({ data, onRemove }) => (
    <div className="relative shrink-0 h-10 flex items-center gap-1.5 rounded-lg overflow-hidden border border-border bg-secondary px-2.5">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
      </svg>
      <span className="max-w-[120px] truncate text-xs text-muted-foreground">{data.fileName}</span>
      <DismissButton onClick={onRemove} absolute />
    </div>
  ),
  toSendContribution: (data) => ({
    images: [{ mimeType: data.mimeType, fileName: data.fileName, content: data.content, previewUrl: data.previewUrl }],
  }),
  cleanup: (data) => URL.revokeObjectURL(data.previewUrl),
};

export const quoteAttachmentPlugin: InputAttachmentPlugin<QuoteData> = {
  kind: "quote",
  renderPreview: ({ data, onRemove }) => (
    <div className="relative shrink-0 h-10 flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/60">
        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
      </svg>
      <span className="max-w-[160px] truncate text-xs text-muted-foreground">{data.text}</span>
      <DismissButton onClick={onRemove} />
    </div>
  ),
  toSendContribution: (data) => ({
    textPrefix: data.text.split("\n").map((l: string) => `> ${l}`).join("\n"),
  }),
};

export const builtinInputAttachmentPlugins: AnyInputAttachmentPlugin[] = [
  imageAttachmentPlugin,
  fileAttachmentPlugin,
  quoteAttachmentPlugin,
];
