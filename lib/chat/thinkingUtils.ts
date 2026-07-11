// Shared utilities for thinking/reasoning text display

export const THINKING_COLLAPSE_THRESHOLD = 5;
export const STREAMING_VISIBLE_SENTENCES = 3;
const MIN_SENTENCE_SPLIT_CHARS = 10;

export function unwrapLineUnderscoreEmphasis(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const leading = line.match(/^\s*/)?.[0] ?? "";
      const trailing = line.match(/\s*$/)?.[0] ?? "";
      const core = line.slice(leading.length, line.length - trailing.length);
      if (core.length < 2) return line;

      const hasSingleUnderscoreWrap = core.startsWith("_") && core.endsWith("_")
        && !core.startsWith("__") && !core.endsWith("__");
      if (!hasSingleUnderscoreWrap) return line;

      const inner = core.slice(1, -1);
      if (!inner.trim()) return line;
      return `${leading}${inner}${trailing}`;
    })
    .join("\n");
}

export function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Split on sentence-ending punctuation followed by space
    const parts = trimmed.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
    const lineSentences: string[] = [];
    let carry = "";

    for (let i = 0; i < parts.length; i++) {
      const candidate = [carry, parts[i]].filter(Boolean).join(" ").trim();
      const hasNext = i < parts.length - 1;

      if (candidate.length < MIN_SENTENCE_SPLIT_CHARS && hasNext) {
        carry = candidate;
        continue;
      }

      if (candidate.length < MIN_SENTENCE_SPLIT_CHARS && lineSentences.length > 0) {
        lineSentences[lineSentences.length - 1] = `${lineSentences[lineSentences.length - 1]} ${candidate}`.trim();
        carry = "";
        continue;
      }

      lineSentences.push(candidate);
      carry = "";
    }

    if (carry) lineSentences.push(carry);
    sentences.push(...lineSentences);
  }
  return sentences;
}
