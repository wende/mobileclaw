import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TurnActivityBox } from "@mc/components/TurnActivityBox";
import type { ContentPart } from "@mc/types/chat";

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
});
