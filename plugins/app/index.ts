import type { AnyMobileClawPlugin } from "@/lib/plugins/types";
import type { AnyInputAttachmentPlugin } from "@/lib/plugins/inputAttachmentTypes";
import { contextChipPlugin, promptContextAttachmentPlugin } from "@/plugins/app/contextChip";
import { tourProgressPlugin } from "./TourProgressPlugin";

export const appPlugins: AnyMobileClawPlugin[] = [
  contextChipPlugin,
  tourProgressPlugin,
];

export const appInputAttachmentPlugins: AnyInputAttachmentPlugin[] = [
  promptContextAttachmentPlugin,
];
