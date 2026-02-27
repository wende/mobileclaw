// Server-side implementations of LM Studio's built-in tools
// Mirrors the danielsig/duckduckgo and danielsig/visit-website plugins

// ── Tool definitions (OpenAI function calling format) ────────────────────────

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "Web_Search",
      description:
        "Search for web pages on DuckDuckGo using a query string and return a list of URLs.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query for finding web pages" },
          pageSize: {
            type: "number",
            description: "Number of web results per page (1-10, default 5)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Image_Search",
      description:
        "Search for images on DuckDuckGo using a query string and return a list of image URLs.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query for finding images" },
          pageSize: {
            type: "number",
            description: "Number of image results per page (1-10, default 5)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Visit_Website",
      description:
        "Visit a website and return its title, headings, links, and text content.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL of the website to visit" },
          contentLimit: {
            type: "number",
            description: "Maximum text content length (default 2000)",
          },
        },
        required: ["url"],
      },
    },
  },
];

// ── Spoof headers to avoid bot detection ─────────────────────────────────────

function spoofHeaders(referer?: string): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (referer) h["Referer"] = referer;
  return h;
}

// ── Tool implementations ─────────────────────────────────────────────────────

async function webSearch(args: { query: string; pageSize?: number }): Promise<string> {
  const pageSize = Math.min(Math.max(args.pageSize || 5, 1), 10);
  const url = new URL("https://duckduckgo.com/html/");
  url.searchParams.append("q", args.query);

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "GET", headers: spoofHeaders(), signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    return `Error: Failed to fetch search results: ${(err as Error).message || "Network error"}`;
  }
  if (!res.ok) return `Error: Failed to fetch search results: ${res.statusText}`;

  const html = await res.text();
  const links: [string, string][] = [];
  const regex = /\shref="[^"]*(https?[^?&"]+)[^>]*>([^<]*)/gm;
  let match;
  while (links.length < pageSize && (match = regex.exec(html))) {
    const label = match[2].replace(/\s+/g, " ").trim();
    const href = decodeURIComponent(match[1]);
    if (!links.some(([, u]) => u === href)) links.push([label, href]);
  }

  if (links.length === 0) return "No web pages found for the query.";
  return JSON.stringify({ links, count: links.length });
}

async function imageSearch(args: { query: string; pageSize?: number }): Promise<string> {
  const pageSize = Math.min(Math.max(args.pageSize || 5, 1), 10);
  const url = new URL("https://duckduckgo.com/");
  url.searchParams.append("q", args.query);
  url.searchParams.append("iax", "images");
  url.searchParams.append("ia", "images");

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "GET", headers: spoofHeaders(), signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    return `Error: Failed to fetch image results: ${(err as Error).message || "Network error"}`;
  }
  if (!res.ok) return `Error: Failed to fetch image results: ${res.statusText}`;

  const html = await res.text();
  // Extract vqd token for image API
  const vqdMatch = html.match(/vqd=['"]([^'"]+)['"]/);
  if (!vqdMatch) return "Error: Could not extract search token for images.";

  const imgUrl = new URL("https://duckduckgo.com/i.js");
  imgUrl.searchParams.append("q", args.query);
  imgUrl.searchParams.append("vqd", vqdMatch[1]);
  imgUrl.searchParams.append("o", "json");

  let imgRes: Response;
  try {
    imgRes = await fetch(imgUrl.toString(), {
      headers: spoofHeaders("https://duckduckgo.com/"),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return `Error: Failed to fetch image results: ${(err as Error).message || "Network error"}`;
  }
  if (!imgRes.ok) return "Error: Failed to fetch image results.";

  const data = await imgRes.json();
  const images = (data.results || []).slice(0, pageSize).map((r: { title: string; image: string }) => ({
    title: r.title,
    url: r.image,
  }));

  if (images.length === 0) return "No images found for the query.";
  return JSON.stringify({ images, count: images.length });
}

async function visitWebsite(args: { url: string; contentLimit?: number }): Promise<string> {
  const contentLimit = args.contentLimit || 2000;

  let res: Response;
  try {
    res = await fetch(args.url, {
      method: "GET",
      headers: spoofHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const msg = (err as Error).name === "TimeoutError"
      ? "Timed out after 15s"
      : (err as Error).message || "Network error";
    return `Error: Failed to visit website: ${msg}`;
  }
  if (!res.ok) return `Error: Failed to visit website: ${res.statusText}`;

  const html = await res.text();

  // Extract title
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || "";

  // Extract headings
  const headings: string[] = [];
  const hRegex = /<h[1-3][^>]*>([^<]*)<\/h[1-3]>/gi;
  let hMatch;
  while (headings.length < 10 && (hMatch = hRegex.exec(html))) {
    const text = hMatch[1].trim();
    if (text) headings.push(text);
  }

  // Extract text content (strip tags, collapse whitespace)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let textContent = bodyMatch?.[1] || html;
  textContent = textContent
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, contentLimit);

  // Extract links
  const links: [string, string][] = [];
  const linkRegex = /<a\s+[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let lMatch;
  while (links.length < 20 && (lMatch = linkRegex.exec(html))) {
    const href = lMatch[1];
    const label = lMatch[2].trim();
    if (href.startsWith("http") && label) links.push([label, href]);
  }

  return JSON.stringify({ title, headings, textContent, links: links.slice(0, 20) });
}

// ── Execute a tool call by name ──────────────────────────────────────────────

export async function executeTool(
  name: string,
  argsJson: string
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return `Error: Invalid JSON arguments: ${argsJson}`;
  }

  // Normalize: lowercase, strip underscores/spaces for flexible matching
  const normalized = name.toLowerCase().replace(/[_ ]/g, "");

  switch (normalized) {
    case "websearch":
      return webSearch(args as { query: string; pageSize?: number });
    case "imagesearch":
      return imageSearch(args as { query: string; pageSize?: number });
    case "visitwebsite":
      return visitWebsite(args as { url: string; contentLimit?: number });
    default:
      return `Error: Unknown tool "${name}"`;
  }
}
