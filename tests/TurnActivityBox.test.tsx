import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { TurnActivityBox } from "@mc/components/TurnActivityBox";
import type { ContentPart } from "@mc/types/chat";

const runningTool: ContentPart[] = [
  {
    type: "tool_call",
    name: "cicada_search",
    arguments: JSON.stringify({ query: "elixir", k: 5 }),
    status: "running",
  },
];

const gridRows = (container: HTMLElement) =>
  (container.querySelector('[style*="grid-template-rows"]') as HTMLElement | null)?.style.gridTemplateRows;

describe("TurnActivityBox", () => {
  it("renders tool label plus narration when narration is only present in arguments", () => {
    const parts: ContentPart[] = [
      {
        type: "tool_call",
        name: "octoclaw__run_piece",
        arguments: JSON.stringify({
          pieceName: "@8claw/piece-8claw",
          actionName: "ask_8claw",
          narration: "Sending a test notification via the 8claw piece",
        }),
        status: "success",
        result: "{\"success\":true}",
      },
    ];

    render(<TurnActivityBox parts={parts} isStreaming={false} />);

    expect(
      screen.getByRole("button", { name: /Octoclaw\s+Run Piece\s+\|\s+Sending a test notification via the 8claw piece/i }),
    ).toBeInTheDocument();
  });

  it("auto-expands a running tool by default", async () => {
    const { container } = render(<TurnActivityBox parts={runningTool} isStreaming />);
    await waitFor(() => expect(gridRows(container)).toBe("1fr"));
  });

  it("keeps a running tool collapsed when hideThinking is set", async () => {
    const { container } = render(<TurnActivityBox parts={runningTool} isStreaming hideThinking />);
    // Let the auto-expand effect run; it must NOT open the row.
    await new Promise((r) => setTimeout(r, 50));
    expect(gridRows(container)).toBe("0fr");
  });
});
