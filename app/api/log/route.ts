import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

const LOG_PATH = join(process.cwd(), "logs.jsonl");

export async function POST(req: Request) {
  try {
    const body = await req.json();
    appendFileSync(LOG_PATH, JSON.stringify(body) + "\n");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
