"use client";

import React, { useState } from "react";

export function StreamingCursor() {
  return <span className="ml-0.5 inline-block h-4 w-[2px] bg-foreground animate-pulse" />;
}

export function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border bg-secondary">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{lang || "text"}</span>
        <button type="button" onClick={copy} className="text-[11px] text-muted-foreground transition-colors hover:text-foreground">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-hidden whitespace-pre-wrap break-all p-3 text-xs leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}

export function MarkdownContent({ text }: { text: string }) {
  // Split text by code blocks first
  const segments = text.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {segments.map((segment, i) => {
        // Fenced code block
        if (segment.startsWith("```") && segment.endsWith("```")) {
          const inner = segment.slice(3, -3);
          const newlineIdx = inner.indexOf("\n");
          const lang = newlineIdx > -1 ? inner.slice(0, newlineIdx).trim() : "";
          const code = newlineIdx > -1 ? inner.slice(newlineIdx + 1) : inner;
          return <CodeBlock key={i} lang={lang} code={code} />;
        }

        // Inline markdown
        return <InlineMarkdown key={i} text={segment} />;
      })}
    </>
  );
}

export function InlineMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={`br-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // Headings
    if (line.startsWith("# ")) {
      elements.push(<h1 key={`h1-${i}`} className="text-lg font-bold text-foreground mt-4 mb-1">{renderInline(line.slice(2))}</h1>);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<h2 key={`h2-${i}`} className="text-base font-semibold text-foreground mt-3 mb-1">{renderInline(line.slice(3))}</h2>);
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(<h3 key={`h3-${i}`} className="text-sm font-semibold text-foreground mt-2 mb-1">{renderInline(line.slice(4))}</h3>);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={`bq-${i}`} className="my-2 border-l-2 border-border pl-3 text-muted-foreground italic">
          {renderInline(quoteLines.join("\n"))}
        </blockquote>
      );
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].match(/^\|?[\s-:|]+\|/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<MarkdownTable key={`tbl-${i}`} lines={tableLines} />);
      continue;
    }

    // Unordered list
    if (line.match(/^(\s*)[-*]\s/)) {
      const listItems: { depth: number; text: string }[] = [];
      while (i < lines.length && lines[i].match(/^(\s*)[-*]\s/)) {
        const match = lines[i].match(/^(\s*)[-*]\s(.*)/);
        if (match) listItems.push({ depth: match[1].length, text: match[2] });
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-1.5 flex flex-col gap-0.5">
          {listItems.map((item, j) => (
            <li key={j} className="flex gap-1.5 text-foreground" style={{ paddingLeft: `${item.depth * 8 + 4}px` }}>
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
              <span>{renderInline(item.text)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        const match = lines[i].match(/^\d+\.\s(.*)/);
        if (match) listItems.push(match[1]);
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-1.5 flex flex-col gap-0.5">
          {listItems.map((item, j) => (
            <li key={j} className="flex gap-1.5 pl-1 text-foreground">
              <span className="shrink-0 text-muted-foreground">{j + 1}.</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph
    elements.push(<p key={`p-${i}`} className="text-foreground">{renderInline(line)}</p>);
    i++;
  }

  return <>{elements}</>;
}

export function renderInline(text: string): React.ReactNode[] {
  // Process: **bold**, *italic*, `inline code`, [link](url)
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) parts.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>);
    else if (match[3]) parts.push(<em key={match.index}>{match[4]}</em>);
    else if (match[5]) parts.push(<code key={match.index} className="rounded bg-secondary px-1 py-0.5 font-mono text-[13px] break-all">{match[6]}</code>);
    else if (match[7]) parts.push(<a key={match.index} href={match[9]} className="underline underline-offset-2 hover:text-foreground" target="_blank" rel="noopener noreferrer">{match[8]}</a>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function MarkdownTable({ lines }: { lines: string[] }) {
  const parseRow = (line: string) => line.split("|").map((c) => c.trim()).filter(Boolean);
  const headers = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-secondary">
            {headers.map((h, i) => <th key={i} className="px-3 py-1.5 text-left font-semibold text-foreground">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {row.map((cell, j) => <td key={j} className="px-3 py-1.5 text-muted-foreground">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
