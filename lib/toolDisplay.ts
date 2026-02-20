// Tool display logic — maps tool names/args to human-friendly labels and icons

export type ToolIcon = "terminal" | "file" | "tool" | "robot" | "globe";

export interface ToolDisplayInfo {
  label: string;
  icon: ToolIcon;
}

function truncatePath(filePath: string, segments = 3): string {
  const parts = filePath.replace(/^\//, "").split("/");
  if (parts.length <= segments) return filePath;
  return ".../" + parts.slice(-segments).join("/");
}

function parseArgs(args?: string): Record<string, unknown> | null {
  if (!args) return null;
  try {
    const parsed = JSON.parse(args);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  return null;
}

export function getToolDisplay(name: string, args?: string): ToolDisplayInfo {
  const parsed = parseArgs(args);

  switch (name) {
    case "exec": {
      const command = parsed?.command;
      if (typeof command === "string") {
        return { label: command, icon: "terminal" };
      }
      return { label: name, icon: "terminal" };
    }

    case "read":
    case "readFile":
    case "read_file": {
      const filePath = parsed?.file_path || parsed?.filePath || parsed?.path;
      if (typeof filePath === "string") {
        return { label: truncatePath(filePath), icon: "file" };
      }
      return { label: "file", icon: "file" };
    }

    case "sessions_spawn": {
      const model = parsed?.model;
      if (typeof model === "string") {
        return { label: model, icon: "robot" };
      }
      return { label: "spawn agent", icon: "robot" };
    }

    case "web_search": {
      const query = parsed?.query;
      if (typeof query === "string") {
        return { label: query, icon: "globe" };
      }
      return { label: name, icon: "globe" };
    }

    case "web_fetch": {
      const url = parsed?.url;
      if (typeof url === "string") {
        return { label: url, icon: "globe" };
      }
      return { label: name, icon: "globe" };
    }

    case "edit":
    case "file_edit":
    case "editFile": {
      const filePath = parsed?.file_path || parsed?.filePath || parsed?.path;
      if (typeof filePath === "string") {
        return { label: truncatePath(filePath), icon: "file" };
      }
      return { label: "file", icon: "file" };
    }

    case "write":
    case "write_file":
    case "writeFile": {
      const filePath = parsed?.file_path || parsed?.filePath || parsed?.path;
      if (typeof filePath === "string") {
        return { label: `Write ${truncatePath(filePath)}`, icon: "file" };
      }
      return { label: "Write file", icon: "file" };
    }

    default:
      return { label: name, icon: "tool" };
  }
}
