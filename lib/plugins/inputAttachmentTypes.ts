import type { ReactNode } from "react";

import type { ImageAttachment } from "@mc/types/chat";

export interface InputAttachmentPreviewProps<TData = unknown> {
  data: TData;
  onRemove: () => void;
  onLightbox?: (src: string) => void;
}

export interface InputAttachmentSendContribution {
  textPrefix?: string;
  images?: ImageAttachment[];
}

export interface InputAttachmentPlugin<TData = unknown> {
  kind: string;
  renderPreview: (props: InputAttachmentPreviewProps<TData>) => ReactNode;
  toSendContribution: (data: TData) => InputAttachmentSendContribution;
  cleanup?: (data: TData) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyInputAttachmentPlugin = InputAttachmentPlugin<any>;
