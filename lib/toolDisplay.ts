// Tool display logic — maps tool names/args to human-friendly labels and icons

import { isReadTool, isEditTool, isWriteTool, isGatewayTool, SPAWN_TOOL_NAME } from "@/lib/constants";

export type ToolIcon = "terminal" | "file" | "tool" | "robot" | "globe" | "gear";

export interface ToolDisplayInfo {
  label: string;
  icon: ToolIcon;
}

function truncatePath(filePath: string, segments = 3): string {
  const parts = filePath.replace(/^\//, "").split("/");
  if (parts.length <= segments) return filePath;
  return ".../" + parts.slice(-segments).join("/");
}

export function parseArgs(args?: string): Record<string, unknown> | null {
  if (!args) return null;
  try {
    const parsed = JSON.parse(args);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  return null;
}

function getFilePath(parsed: Record<string, unknown> | null): string | null {
  const filePath = parsed?.file_path || parsed?.filePath || parsed?.path;
  return typeof filePath === "string" ? filePath : null;
}

export function getToolDisplay(name: string, args?: string): ToolDisplayInfo {
  const parsed = parseArgs(args);

  if (name === "exec") {
    const command = parsed?.command;
    return { label: typeof command === "string" ? command : name, icon: "terminal" };
  }

  if (isReadTool(name)) {
    const filePath = getFilePath(parsed);
    return { label: filePath ? truncatePath(filePath) : "file", icon: "file" };
  }

  if (isEditTool(name)) {
    const filePath = getFilePath(parsed);
    return { label: filePath ? truncatePath(filePath) : "file", icon: "file" };
  }

  if (isWriteTool(name)) {
    const filePath = getFilePath(parsed);
    return { label: filePath ? `Write ${truncatePath(filePath)}` : "Write file", icon: "file" };
  }

  if (name === SPAWN_TOOL_NAME) {
    const model = parsed?.model;
    return { label: typeof model === "string" ? model : "spawn agent", icon: "robot" };
  }

  if (name === "web_search") {
    const query = parsed?.query;
    return { label: typeof query === "string" ? query : name, icon: "globe" };
  }

  if (isGatewayTool(name)) {
    const action = parsed?.action;
    return { label: typeof action === "string" ? action : "gateway", icon: "gear" };
  }

  if (name === "web_fetch") {
    const url = parsed?.url;
    return { label: typeof url === "string" ? url : name, icon: "globe" };
  }

  return { label: name, icon: "tool" };
}
