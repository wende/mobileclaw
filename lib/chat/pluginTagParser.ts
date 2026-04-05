/**
 * Parses <plugin> tags from assistant text content.
 *
 * The MCP server wraps tool visualizations in <plugin type="..." data='...'> tags
 * with ASCII fallback inside. This parser splits text into segments so MobileClaw
 * can render rich widgets (hiding the ASCII) while other clients see the fallback.
 */

export interface TextSegment {
  kind: "text";
  text: string;
}

export interface PluginSegment {
  kind: "plugin";
  pluginType: string;
  data: unknown;
  fallbackText: string;
}

export type ParsedSegment = TextSegment | PluginSegment;

const PLUGIN_TAG_RE = /<plugin\s+type="([^"]+)"\s+data='([^']*)'>([\s\S]*?)<\/plugin>/g;

/**
 * Parse text for <plugin> tags. Returns an array of segments.
 *
 * - No tags found → single TextSegment with original text
 * - Malformed JSON in data attr → treated as plain text (graceful degradation)
 * - Incomplete tags (no closing </plugin>) → passed through as text
 */
export function parsePluginTags(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(PLUGIN_TAG_RE)) {
    const [fullMatch, type, dataAttr, innerText] = match;
    const matchStart = match.index!;

    // Add preceding text
    if (matchStart > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, matchStart) });
    }

    // Try to parse the data attribute JSON
    let data: unknown;
    try {
      data = JSON.parse(dataAttr.replace(/\\u0027/g, "'"));
    } catch {
      // Malformed JSON — treat the whole match as plain text
      segments.push({ kind: "text", text: fullMatch });
      lastIndex = matchStart + fullMatch.length;
      continue;
    }

    segments.push({
      kind: "plugin",
      pluginType: type,
      data,
      fallbackText: innerText,
    });

    lastIndex = matchStart + fullMatch.length;
  }

  // Add trailing text
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }

  // If no matches at all, return single text segment
  if (segments.length === 0) {
    return [{ kind: "text", text }];
  }

  return segments;
}
