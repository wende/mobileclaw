import { NextRequest, NextResponse } from "next/server";
import { appendFile } from "fs/promises";
import { join } from "path";

const LOG_PATH = join(process.cwd(), "logs.jsonl");

export async function POST(req: NextRequest) {
  try {
    const entry = await req.json();
    await appendFile(LOG_PATH, JSON.stringify(entry) + "\n");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
