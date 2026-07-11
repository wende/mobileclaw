import type { AnyMobileClawPlugin } from "@mc/lib/plugins/types";
import type { AnyInputAttachmentPlugin } from "@mc/lib/plugins/inputAttachmentTypes";
import { contextChipPlugin, promptContextAttachmentPlugin } from "@mc/plugins/app/contextChip";
import { flowRunAttachmentPlugin } from "@mc/plugins/app/flowRunChip";
import { notificationCardPlugin } from "@mc/plugins/app/notificationCard";
import { flowRunCardPlugin } from "@mc/plugins/app/flowRunCard";
import { flowListCardPlugin } from "@mc/plugins/app/flowListCard";
import { flowRunListCardPlugin } from "@mc/plugins/app/flowRunListCard";
import { flowRunDetailCardPlugin } from "@mc/plugins/app/flowRunDetailCard";
import { flowCanvasCardPlugin } from "@mc/plugins/app/flowCanvasCard";

export const appPlugins: AnyMobileClawPlugin[] = [
  contextChipPlugin,
  notificationCardPlugin,
  flowRunCardPlugin,
  flowListCardPlugin,
  flowRunListCardPlugin,
  flowRunDetailCardPlugin,
  flowCanvasCardPlugin,
];

export const appInputAttachmentPlugins: AnyInputAttachmentPlugin[] = [
  promptContextAttachmentPlugin,
  flowRunAttachmentPlugin,
];
