import { builtinInputAttachmentPlugins } from "@mc/lib/plugins/inputAttachmentBuiltins";
import { appInputAttachmentPlugins } from "@mc/plugins/app";
import type { AnyInputAttachmentPlugin } from "@mc/lib/plugins/inputAttachmentTypes";

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
