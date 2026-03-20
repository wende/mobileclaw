import type { CanvasPayload, ContentPart, PluginContentPart } from "@mc/types/chat";

function getLegacyCanvasPartId(canvas: CanvasPayload): string {
  return canvas.partId || `legacy-canvas:${canvas.type}`;
}

export function ensureContentArray(content: ContentPart[] | string | null | undefined): ContentPart[] {
  if (!content) return [];
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  return [...content];
}

export function canvasToPluginPart(canvas: CanvasPayload): PluginContentPart {
  return {
    type: "plugin",
    partId: getLegacyCanvasPartId(canvas),
    pluginType: canvas.type,
    state: canvas.state,
    data: canvas.data,
    schemaVersion: canvas.schemaVersion,
    revision: canvas.revision,
  };
}

export function appendCanvasPart(content: ContentPart[] | string | null | undefined, canvas?: CanvasPayload): ContentPart[] {
  const parts = ensureContentArray(content);
  if (!canvas) return parts;

  const pluginPart = canvasToPluginPart(canvas);
  const existingIdx = parts.findIndex(
    (part) => part.type === "plugin" && part.partId === pluginPart.partId,
  );
  if (existingIdx >= 0) {
    parts[existingIdx] = { ...parts[existingIdx], ...pluginPart };
    return parts;
  }
  parts.push(pluginPart);
  return parts;
}
