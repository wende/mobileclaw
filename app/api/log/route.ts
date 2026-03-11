import { appendFile, stat, truncate } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const LOG_PATH = join(process.cwd(), "logs.jsonl");
const MAX_LOG_BYTES = 5 * 1024 * 1024;

async function truncateIfOversized() {
  try {
    const { size } = await stat(LOG_PATH);
    if (size < MAX_LOG_BYTES) return;
    await truncate(LOG_PATH, 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await truncateIfOversized();
    await appendFile(LOG_PATH, JSON.stringify(body) + "\n", "utf8");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/log] Failed to append log entry:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
