import { NextRequest, NextResponse } from "next/server";

// Rate limiting: 30 requests per minute
let requestCount = 0;
let windowStart = Date.now();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(): boolean {
  const now = Date.now();
  if (now - windowStart > RATE_WINDOW_MS) {
    requestCount = 0;
    windowStart = now;
  }
  requestCount++;
  return requestCount <= RATE_LIMIT;
}

// SSRF prevention: reject private/loopback IPs
function isPrivateHost(hostname: string): boolean {
  // Loopback
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") return true;
  // Private IPv4 ranges
  if (/^10\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  // Link-local
  if (/^169\.254\./.test(hostname)) return true;
  return false;
}

// Parse OG tags + title + favicon from HTML via regex
function parseMetadata(html: string, url: string): Record<string, string | undefined> {
  const get = (property: string): string | undefined => {
    // Match <meta property="og:..." content="..."> or <meta name="..." content="...">
    const re = new RegExp(
      `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']|<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
      "i",
    );
    const m = html.match(re);
    return m?.[1] ?? m?.[2] ?? undefined;
  };

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);

  // Favicon: look for <link rel="icon" href="...">
  const faviconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']*)["']/i)
    ?? html.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["'](?:shortcut )?icon["']/i);

  let favicon = faviconMatch?.[1];
  if (favicon && !favicon.startsWith("http")) {
    try {
      favicon = new URL(favicon, url).href;
    } catch {
      favicon = undefined;
    }
  }

  let image = get("og:image");
  if (image && !image.startsWith("http")) {
    try {
      image = new URL(image, url).href;
    } catch {
      image = undefined;
    }
  }

  return {
    title: get("og:title") ?? titleMatch?.[1]?.trim(),
    description: get("og:description") ?? get("description"),
    image,
    siteName: get("og:site_name"),
    favicon,
  };
}

export async function GET(request: NextRequest) {
  if (!checkRateLimit()) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Invalid scheme" }, { status: 400 });
  }

  if (isPrivateHost(parsed.hostname)) {
    return NextResponse.json({ error: "Private host not allowed" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "MobileClaw/1.0 (Link Preview)",
        Accept: "text/html",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ error: "Unreachable" }, { status: 422 });
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return NextResponse.json({ error: "Not HTML" }, { status: 422 });
    }

    // Read only first 64KB
    const reader = res.body?.getReader();
    if (!reader) {
      return NextResponse.json({ error: "No body" }, { status: 422 });
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const MAX_BYTES = 64 * 1024;

    while (totalBytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.length;
    }
    reader.cancel().catch(() => {});

    const html = new TextDecoder().decode(
      chunks.length === 1 ? chunks[0] : Buffer.concat(chunks),
    );

    const meta = parseMetadata(html, url);
    const domain = parsed.hostname.replace(/^www\./, "");

    if (!meta.title && !meta.description) {
      return NextResponse.json({ error: "No metadata found" }, { status: 422 });
    }

    const data = {
      url,
      title: meta.title,
      description: meta.description,
      image: meta.image,
      siteName: meta.siteName,
      favicon: meta.favicon,
      domain,
    };

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return NextResponse.json({ error: "Unreachable" }, { status: 422 });
  }
}
