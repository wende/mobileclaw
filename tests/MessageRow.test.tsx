import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageRow } from "@/components/MessageRow";
import type { Message } from "@/types/chat";

describe("MessageRow", () => {
  it("renders user message text", () => {
    const message: Message = {
      role: "user",
      content: [{ type: "text", text: "Hello, world!" }],
      id: "test-1",
    };
    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText("Hello, world!")).toBeInTheDocument();
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
});
