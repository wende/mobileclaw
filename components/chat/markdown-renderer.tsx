"use client";

import React from "react"

import { useMemo } from "react";

function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const full = match[0];

    if (match[1]) {
      nodes.push(
        <code
          key={match.index}
          className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {full.slice(1, -1)}
        </code>
      );
    } else if (match[2]) {
      nodes.push(
        <strong key={match.index} className="font-semibold">
          {full.slice(2, -2)}
        </strong>
      );
    } else if (match[3]) {
      nodes.push(
        <em key={match.index} className="italic">
          {full.slice(1, -1)}
        </em>
      );
    } else if (match[4]) {
      const linkMatch = full.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        nodes.push(
          <a
            key={match.index}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 decoration-foreground/30 hover:decoration-foreground/60 transition-colors"
          >
            {linkMatch[1]}
          </a>
        );
      }
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border bg-secondary/50">
      {language && (
        <div className="flex items-center justify-between border-b border-border bg-secondary/80 px-4 py-2">
          <span className="font-mono text-xs text-muted-foreground">
            {language}
          </span>
        </div>
      )}
      <pre className="overflow-x-auto p-4">
        <code className="font-mono text-sm leading-relaxed text-foreground">
          {code}
        </code>
      </pre>
    </div>
  );
}

function TableBlock({ header, rows }: { header: string[]; rows: string[][] }) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/50">
            {header.map((cell, i) => (
              <th
                key={i}
                className="px-4 py-2.5 text-left font-medium text-foreground"
              >
                {cell.trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border last:border-0"
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="px-4 py-2.5 text-muted-foreground"
                >
                  {parseInline(cell.trim())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MarkdownRenderer({ content }: { content: string }) {
  const rendered = useMemo(() => {
    const lines = content.split("\n");
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Code blocks
      if (line.startsWith("```")) {
        const language = line.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        elements.push(
          <CodeBlock
            key={`code-${i}`}
            language={language}
            code={codeLines.join("\n")}
          />
        );
        i++;
        continue;
      }

      // Table detection
      if (
        line.includes("|") &&
        i + 1 < lines.length &&
        lines[i + 1].match(/^\|[\s-|]+\|$/)
      ) {
        const headerCells = line
          .split("|")
          .filter((c) => c.trim() !== "");
        i += 2; // Skip header and separator
        const rows: string[][] = [];
        while (i < lines.length && lines[i].includes("|")) {
          rows.push(lines[i].split("|").filter((c) => c.trim() !== ""));
          i++;
        }
        elements.push(
          <TableBlock
            key={`table-${i}`}
            header={headerCells}
            rows={rows}
          />
        );
        continue;
      }

      // Headings
      if (line.startsWith("# ")) {
        elements.push(
          <h1
            key={`h1-${i}`}
            className="mt-6 mb-3 text-xl font-semibold text-foreground first:mt-0"
          >
            {parseInline(line.slice(2))}
          </h1>
        );
        i++;
        continue;
      }
      if (line.startsWith("## ")) {
        elements.push(
          <h2
            key={`h2-${i}`}
            className="mt-5 mb-2 text-lg font-semibold text-foreground first:mt-0"
          >
            {parseInline(line.slice(3))}
          </h2>
        );
        i++;
        continue;
      }
      if (line.startsWith("### ")) {
        elements.push(
          <h3
            key={`h3-${i}`}
            className="mt-4 mb-2 text-base font-semibold text-foreground first:mt-0"
          >
            {parseInline(line.slice(4))}
          </h3>
        );
        i++;
        continue;
      }

      // Blockquote
      if (line.startsWith("> ")) {
        elements.push(
          <blockquote
            key={`bq-${i}`}
            className="my-2 border-l-2 border-border pl-4 text-muted-foreground italic"
          >
            {parseInline(line.slice(2))}
          </blockquote>
        );
        i++;
        continue;
      }

      // Unordered list
      if (line.match(/^(\s*)- /)) {
        const listItems: { indent: number; text: string }[] = [];
        while (i < lines.length && lines[i].match(/^(\s*)- /)) {
          const m = lines[i].match(/^(\s*)- (.+)/);
          if (m) {
            listItems.push({ indent: m[1].length, text: m[2] });
          }
          i++;
        }
        elements.push(
          <ul key={`ul-${i}`} className="my-2 flex flex-col gap-1.5">
            {listItems.map((item, j) => (
              <li
                key={j}
                className="flex items-start gap-2 text-foreground"
                style={{ paddingLeft: `${item.indent * 8 + 4}px` }}
              >
                <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                <span className="leading-relaxed">
                  {parseInline(item.text)}
                </span>
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // Ordered list
      if (line.match(/^\d+\. /)) {
        const listItems: string[] = [];
        while (i < lines.length && lines[i].match(/^\d+\. /)) {
          const m = lines[i].match(/^\d+\. (.+)/);
          if (m) listItems.push(m[1]);
          i++;
        }
        elements.push(
          <ol key={`ol-${i}`} className="my-2 flex flex-col gap-1.5">
            {listItems.map((item, j) => (
              <li
                key={j}
                className="flex items-start gap-2.5 pl-1 text-foreground"
              >
                <span className="mt-px shrink-0 font-mono text-xs text-muted-foreground/70 tabular-nums min-w-[1.25rem] text-right">
                  {j + 1}.
                </span>
                <span className="leading-relaxed">
                  {parseInline(item)}
                </span>
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // Empty line
      if (line.trim() === "") {
        i++;
        continue;
      }

      // Regular paragraph
      elements.push(
        <p key={`p-${i}`} className="leading-relaxed text-foreground">
          {parseInline(line)}
        </p>
      );
      i++;
    }

    return elements;
  }, [content]);

  return <div className="flex flex-col gap-2">{rendered}</div>;
}
