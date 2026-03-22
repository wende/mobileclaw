import type { AnyMobileClawPlugin } from "@mc/lib/plugins/types";
import type { AnyInputAttachmentPlugin } from "@mc/lib/plugins/inputAttachmentTypes";
import { contextChipPlugin, promptContextAttachmentPlugin } from "@mc/plugins/app/contextChip";
import { flowRunAttachmentPlugin } from "@mc/plugins/app/flowRunChip";
import { connectionAttachmentPlugin } from "@mc/plugins/app/connectionChip";
import { flowListCardPlugin } from "@mc/plugins/app/flowListCard";
import { flowRunCardPlugin } from "@mc/plugins/app/flowRunCard";
import { flowRunListCardPlugin } from "@mc/plugins/app/flowRunListCard";
import { flowRunDetailCardPlugin } from "@mc/plugins/app/flowRunDetailCard";
import { connectionListCardPlugin } from "@mc/plugins/app/connectionListCard";
import { notificationCardPlugin } from "@mc/plugins/app/notificationCard";
import { tourProgressPlugin } from "./TourProgressPlugin";

export const appPlugins: AnyMobileClawPlugin[] = [
  contextChipPlugin,
  tourProgressPlugin,
  notificationCardPlugin,
  flowRunCardPlugin,
  flowRunListCardPlugin,
  flowRunDetailCardPlugin,
  flowListCardPlugin,
  connectionListCardPlugin,
];

export const appInputAttachmentPlugins: AnyInputAttachmentPlugin[] = [
  promptContextAttachmentPlugin,
  flowRunAttachmentPlugin,
  connectionAttachmentPlugin,
];
