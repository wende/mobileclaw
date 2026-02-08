import type { ContentPart } from "@/types/chat";

export function getTextFromContent(content: ContentPart[] | string | null): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.filter((p) => p.type === "text" && p.text).map((p) => p.text).join("");
}

export function getToolCalls(content: ContentPart[] | string | null): ContentPart[] {
  if (!content || typeof content === "string") return [];
  return content.filter((p) => p.type === "tool_call" || p.type === "toolCall");
}

export function getImages(content: ContentPart[] | string | null): ContentPart[] {
  if (!content || typeof content === "string") return [];
  return content.filter((p) => p.type === "image" || p.type === "image_url");
}

export function getMessageSide(role: string): "left" | "right" | "center" {
  if (role === "user") return "right";
  if (role === "assistant" || role === "toolResult" || role === "tool_result") return "left";
  return "center";
}

export function formatMessageTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  if (isYesterday) return `Yesterday ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export function thinkingPreview(text: string): string {
  // Try to extract **bold** text
  const boldMatch = text.match(/\*\*(.+?)\*\*/);
  if (boldMatch) return boldMatch[1];
  // Fallback: first 8 words
  const words = text.trim().split(/\s+/).slice(0, 8).join(" ");
  return words + (text.trim().split(/\s+/).length > 8 ? "..." : "");
}
