import type { AnyMobileClawPlugin } from "@mc/lib/plugins/types";
import type { AnyInputAttachmentPlugin } from "@mc/lib/plugins/inputAttachmentTypes";
import { contextChipPlugin, promptContextAttachmentPlugin } from "@mc/plugins/app/contextChip";
import { flowRunAttachmentPlugin } from "@mc/plugins/app/flowRunChip";
import { tourProgressPlugin } from "./TourProgressPlugin";

export const appPlugins: AnyMobileClawPlugin[] = [
  contextChipPlugin,
  tourProgressPlugin,
];

export const appInputAttachmentPlugins: AnyInputAttachmentPlugin[] = [
  promptContextAttachmentPlugin,
  flowRunAttachmentPlugin,
];
