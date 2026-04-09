function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON payloads.
  }
  return undefined;
}

function narrationFromObject(obj: Record<string, unknown>): string | undefined {
  return asNonEmptyString(obj.narration);
}

export function extractToolNarration(eventData: Record<string, unknown>): string | undefined {
  const topLevel = asNonEmptyString(eventData.narration);
  if (topLevel) return topLevel;

  const args = eventData.args;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const fromArgsObject = narrationFromObject(args as Record<string, unknown>);
    if (fromArgsObject) return fromArgsObject;
  } else if (typeof args === "string") {
    const parsedArgs = parseJsonObject(args);
    if (parsedArgs) {
      const fromArgsString = narrationFromObject(parsedArgs);
      if (fromArgsString) return fromArgsString;
    }
  }

  const meta = eventData.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const fromMeta = narrationFromObject(meta as Record<string, unknown>);
    if (fromMeta) return fromMeta;
  }

  return undefined;
}

export function serializeToolArgs(args: unknown): string | undefined {
  if (args === undefined) return undefined;
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args);
  } catch {
    return JSON.stringify(args);
  }
}
