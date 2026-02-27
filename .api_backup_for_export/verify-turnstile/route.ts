import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return NextResponse.json({ ok: true }); // disabled in dev

  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  if (ip) form.append("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const data = await res.json() as { success: boolean };
  if (!data.success) return NextResponse.json({ error: "Failed" }, { status: 403 });

  return NextResponse.json({ ok: true });
}
