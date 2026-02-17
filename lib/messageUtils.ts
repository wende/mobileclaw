import type { ContentPart, Message, MessageRole } from "@/types/chat";

/** Immutable update of a single array element by index. */
export function updateAt<T>(arr: T[], index: number, updater: (item: T) => T): T[] {
  if (index < 0 || index >= arr.length) return arr;
  return [...arr.slice(0, index), updater(arr[index]), ...arr.slice(index + 1)];
}

/** Immutable update of a Message in an array, found by id. Returns unchanged array if not found. */
export function updateMessageById(
  messages: Message[],
  id: string,
  updater: (msg: Message) => Message
): Message[] {
  const idx = messages.findIndex((m) => m.id === id);
  if (idx < 0) return messages;
  return updateAt(messages, idx, updater);
}

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

export function getMessageSide(role: MessageRole): "left" | "right" | "center" {
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
