import { builtinInputAttachmentPlugins } from "@/lib/plugins/inputAttachmentBuiltins";
import { appInputAttachmentPlugins } from "@/plugins/app";
import type { AnyInputAttachmentPlugin } from "@/lib/plugins/inputAttachmentTypes";

const registry = new Map<string, AnyInputAttachmentPlugin>();

for (const plugin of [...builtinInputAttachmentPlugins, ...appInputAttachmentPlugins]) {
  registry.set(plugin.kind, plugin);
}

export const inputAttachmentRegistry = {
  get(kind: string): AnyInputAttachmentPlugin | undefined {
    return registry.get(kind);
  },
  list(): AnyInputAttachmentPlugin[] {
    return [...registry.values()];
  },
};
