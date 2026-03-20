import type { AnyMobileClawPlugin } from "@/lib/plugins/types";
import type { AnyInputAttachmentPlugin } from "@/lib/plugins/inputAttachmentTypes";
import { contextChipPlugin, promptContextAttachmentPlugin } from "@/plugins/app/contextChip";

export const appPlugins: AnyMobileClawPlugin[] = [
  contextChipPlugin,
];

export const appInputAttachmentPlugins: AnyInputAttachmentPlugin[] = [
  promptContextAttachmentPlugin,
];
