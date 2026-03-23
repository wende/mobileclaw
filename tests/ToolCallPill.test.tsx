import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToolCallPill } from "@mc/components/ToolCallPill";
import { findSlideGrid } from "./utils/zenDom";

describe("ToolCallPill", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collapses on mouse up without breaking text selection", () => {
    const getSelectionMock = vi.spyOn(window, "getSelection");
    getSelectionMock.mockReturnValue(null);

    render(
      <ToolCallPill
        name="run_command"
        result={"line one\nline two"}
      />
    );

    const header = screen.getByRole("button");
    const resultLabel = screen.getByText("Result");
    const slideGrid = findSlideGrid(resultLabel);

    expect(slideGrid).not.toBeNull();
    expect(slideGrid).toHaveStyle({ gridTemplateRows: "0fr" });

    fireEvent.mouseUp(header, { button: 0 });
    expect(slideGrid).toHaveStyle({ gridTemplateRows: "1fr" });

    getSelectionMock.mockReturnValue({
      isCollapsed: false,
      toString: () => "line one",
    } as unknown as Selection);

    const resultContent = screen.getByText((content, node) => node?.textContent === "line one\nline two" && node.tagName === "PRE");
    fireEvent.mouseUp(resultContent, { button: 0 });
    expect(slideGrid).toHaveStyle({ gridTemplateRows: "1fr" });

    getSelectionMock.mockReturnValue({
      isCollapsed: true,
      toString: () => "",
    } as unknown as Selection);

    fireEvent.mouseUp(resultContent, { button: 0 });
    expect(slideGrid).toHaveStyle({ gridTemplateRows: "0fr" });
  });
});
