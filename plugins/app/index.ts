import type { AnyMobileClawPlugin } from "@mc/lib/plugins/types";
import type { AnyInputAttachmentPlugin } from "@mc/lib/plugins/inputAttachmentTypes";
import { contextChipPlugin, promptContextAttachmentPlugin } from "@mc/plugins/app/contextChip";

export const appPlugins: AnyMobileClawPlugin[] = [
  contextChipPlugin,
];

export const appInputAttachmentPlugins: AnyInputAttachmentPlugin[] = [
  promptContextAttachmentPlugin,
];
