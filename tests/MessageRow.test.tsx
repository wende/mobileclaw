import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MessageRow } from "@/components/MessageRow";
import type { Message } from "@/types/chat";
import { findSlideGrid } from "./utils/zenDom";

describe("MessageRow", () => {
  it("renders user message text", () => {
    const message: Message = {
      role: "user",
      content: [{ type: "text", text: "Hello, world!" }],
      id: "test-1",
    };
    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText("Hello, world!")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy contents/i })).not.toBeInTheDocument();
  });

  it("renders assistant message text", () => {
    const message: Message = {
      role: "assistant",
      content: [{ type: "text", text: "Hi there!" }],
      id: "test-2",
    };
    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText("Hi there!")).toBeInTheDocument();
  });

  it("renders a copy button for assistant messages and copies cleaned contents", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const message: Message = {
      role: "assistant",
      content: [{ type: "text", text: "<think>Internal notes</think><final>Hello there</final>" }],
      id: "test-copy",
      runDuration: 7,
    };

    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.queryByText("Copy contents")).not.toBeInTheDocument();
    expect(screen.getByText("· Worked for 7s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy contents" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Hello there");
      expect(screen.queryByText("Copied")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    });
  });

  it("hides the copy button while an assistant message is still streaming", () => {
    const message: Message = {
      role: "assistant",
      content: [{ type: "text", text: "Streaming reply" }],
      id: "test-copy-streaming",
    };

    render(<MessageRow message={message} isStreaming />);
    expect(screen.queryByRole("button", { name: /copy contents/i })).not.toBeInTheDocument();
  });

  it("slides in thinking blocks when they first appear", async () => {
    const message: Message = {
      role: "assistant",
      content: [],
      reasoning: "Thinking through the request",
      id: "test-thinking-slide",
    };

    render(<MessageRow message={message} isStreaming />);

    const initialGrid = findSlideGrid(screen.getByText("Thinking through the request"));
    expect(initialGrid).not.toBeNull();
    expect(initialGrid).toHaveStyle({ gridTemplateRows: "0fr" });

    await waitFor(() => {
      const openGrid = findSlideGrid(screen.getByText("Thinking through the request"));
      expect(openGrid).not.toBeNull();
      expect(openGrid).toHaveStyle({ gridTemplateRows: "1fr" });
    });
  });

  it("unwraps markdown-style underscore emphasis in thinking blocks", () => {
    const message: Message = {
      role: "assistant",
      content: [],
      reasoning: "Reasoning:\n_The user_",
      id: "test-thinking-underscore",
    };

    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText(/The user/)).toBeInTheDocument();
    expect(screen.queryByText("_The user_")).not.toBeInTheDocument();
  });

  it("unwraps outer underscore emphasis even when inner text contains underscores", () => {
    const message: Message = {
      role: "assistant",
      content: [],
      reasoning: "Reasoning:\n_The user has an open_claw server_",
      id: "test-thinking-underscore-inner",
    };

    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText(/open_claw/)).toBeInTheDocument();
    expect(screen.queryByText("_The user has an open_claw server_")).not.toBeInTheDocument();
  });

  it("renders system message centered", () => {
    const message: Message = {
      role: "system",
      content: [{ type: "text", text: "Welcome to demo mode" }],
      id: "test-3",
    };
    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText("Welcome to demo mode")).toBeInTheDocument();
  });

  it("returns null for tool_result messages", () => {
    const message: Message = {
      role: "tool_result",
      content: [{ type: "text", text: "result data" }],
      id: "test-4",
    };
    const { container } = render(<MessageRow message={message} isStreaming={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders tool call pills for assistant messages", () => {
    const message: Message = {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          name: "exec",
          arguments: JSON.stringify({ command: "ls -la" }),
          status: "success",
          result: "file1.txt\nfile2.txt",
        },
        { type: "text", text: "Here are the files." },
      ],
      id: "test-5",
    };
    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText("Here are the files.")).toBeInTheDocument();
  });

  it("renders string content directly", () => {
    const message: Message = {
      role: "assistant",
      content: "Plain string content",
      id: "test-6",
    };
    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText("Plain string content")).toBeInTheDocument();
  });

  it("renders null for system message with empty content", () => {
    const message: Message = {
      role: "system",
      content: null,
      id: "test-7",
    };
    const { container } = render(<MessageRow message={message} isStreaming={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders context messages as expandable pill", () => {
    const message: Message = {
      role: "user",
      content: [{ type: "text", text: "System: [file] some context data" }],
      id: "test-8",
      isContext: true,
    };
    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText("some context data")).toBeInTheDocument();
  });

  it("renders command response as expandable pill", () => {
    const message: Message = {
      role: "assistant",
      content: [{ type: "text", text: "/status result\nMore details here" }],
      id: "test-9",
      isCommandResponse: true,
      runDuration: 2,
    };
    render(<MessageRow message={message} isStreaming={false} />);
    // Summary should be "/status result"
    expect(screen.getByText("/status result")).toBeInTheDocument();
    const footer = screen.getByRole("button", { name: "Copy contents" }).parentElement;
    expect(footer).not.toBeNull();
    expect(within(footer as HTMLElement).getByText("· Worked for 2s")).toBeInTheDocument();
  });

  it("renders command response spinner when text is empty", () => {
    const message: Message = {
      role: "assistant",
      content: [],
      id: "test-10",
      isCommandResponse: true,
    };
    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText("Running...")).toBeInTheDocument();
  });

  it("renders full assistant content when zen mode is off", () => {
    const message: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "Step one" },
        { type: "tool_call", name: "exec", arguments: "{\"command\":\"echo 1\"}", status: "success", result: "1" },
        { type: "text", text: "Step two" },
        { type: "tool_call", name: "exec", arguments: "{\"command\":\"echo 2\"}", status: "success", result: "2" },
        { type: "text", text: "Final answer" },
      ],
      id: "zen-off",
    };

    render(<MessageRow message={message} isStreaming={false} zenMode={false} />);
    expect(screen.getByText("Step one")).toBeInTheDocument();
    expect(screen.getByText("Step two")).toBeInTheDocument();
    expect(screen.getByText("Final answer")).toBeInTheDocument();
  });

  it("renders zen toggle for block-collapsible rows and calls toggle handler", () => {
    const message: Message = {
      role: "assistant",
      content: [{ type: "text", text: "Final answer" }],
      id: "zen-toggle",
    };
    const onZenGroupToggle = vi.fn();

    render(
      <MessageRow
        message={message}
        isStreaming={false}
        zenMode
        zenGroupCollapsible
        zenGroupExpanded={false}
        onZenGroupToggle={onZenGroupToggle}
      />,
    );

    const toggle = screen.getByTestId("zen-toggle");
    expect(toggle).toHaveAttribute("aria-label", "Expand assistant steps");
    fireEvent.click(toggle);
    expect(onZenGroupToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Final answer")).toBeInTheDocument();
  });

  it("renders zen toggle in expanded state with collapse semantics", () => {
    const message: Message = {
      role: "assistant",
      content: [{ type: "text", text: "Final answer" }],
      id: "zen-toggle-expanded",
    };

    render(
      <MessageRow
        message={message}
        isStreaming={false}
        zenMode
        zenGroupCollapsible
        zenGroupExpanded
        onZenGroupToggle={() => {}}
      />,
    );

    const toggle = screen.getByTestId("zen-toggle");
    expect(toggle).toHaveAttribute("aria-label", "Collapse assistant steps");
    const chevron = toggle.querySelector("svg");
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveStyle({ transform: "rotate(180deg)" });
    expect(screen.getByText("Final answer")).toBeInTheDocument();
  });

  it("hides collapsed sibling rows in zen mode and reveals when expanded", async () => {
    const message: Message = {
      role: "assistant",
      content: [{ type: "text", text: "Step one" }],
      id: "zen-sibling",
    };

    const { rerender } = render(
      <MessageRow
        message={message}
        isStreaming={false}
        zenMode
        zenCollapsedByGroup
        zenGroupExpanded={false}
        zenGroupSlideOpen={false}
        zenGroupFadeVisible={false}
      />,
    );
    const initialGrid = findSlideGrid(screen.getByText("Step one"));
    expect(initialGrid).not.toBeNull();
    expect(initialGrid).toHaveStyle({ gridTemplateRows: "0fr" });

    rerender(
      <MessageRow
        message={message}
        isStreaming={false}
        zenMode
        zenCollapsedByGroup
        zenGroupExpanded
        zenGroupSlideOpen
        zenGroupFadeVisible
      />,
    );
    await waitFor(() => {
      const expandedGrid = findSlideGrid(screen.getByText("Step one"));
      expect(expandedGrid).not.toBeNull();
      expect(expandedGrid).toHaveStyle({ gridTemplateRows: "1fr" });
    });
  });

  it("does not render zen chevron without a block-collapsible flag", () => {
    const message: Message = {
      role: "assistant",
      content: [{ type: "text", text: "Just one group" }],
      id: "zen-single",
    };

    render(<MessageRow message={message} isStreaming={false} zenMode />);
    expect(screen.getByText("Just one group")).toBeInTheDocument();
    expect(screen.queryByTestId("zen-toggle")).not.toBeInTheDocument();
  });
});
