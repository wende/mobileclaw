import { execSync } from "child_process";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const sha = execSync("git rev-parse --short HEAD").toString().trim();
    return Response.json({ sha });
  } catch {
    return Response.json({ sha: "dev" });
  }
}
