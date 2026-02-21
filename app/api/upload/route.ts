import { NextRequest, NextResponse } from "next/server";

// Proxy upload to catbox.moe — free, no API key, returns a public URL.
// Files are stored permanently (use litterbox.catbox.moe for temporary).

export async function POST(req: NextRequest) {
  try {
    const { content, mimeType, fileName } = (await req.json()) as {
      content: string; // base64
      mimeType: string;
      fileName?: string;
    };
    if (!content || !mimeType?.startsWith("image/")) {
      return NextResponse.json({ error: "Invalid image" }, { status: 400 });
    }
    const buf = Buffer.from(content, "base64");
    if (buf.length > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Image too large (5MB max)" }, { status: 413 });
    }

    const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const name = fileName || `image.${ext}`;

    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", new File([buf], name, { type: mimeType }));

    const res = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[Upload] catbox error:", res.status, text);
      return NextResponse.json({ error: `Upload failed: ${text}` }, { status: 502 });
    }

    const url = (await res.text()).trim();
    console.log("[Upload] success:", url, `(${(buf.length / 1024).toFixed(1)}KB)`);
    return NextResponse.json({ url });
  } catch (e) {
    console.error("[Upload] exception:", e);
    return NextResponse.json(
      { error: `Upload failed: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 500 },
    );
  }
}
