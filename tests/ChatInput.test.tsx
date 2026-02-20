import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "@/components/ChatInput";

const defaultProps = {
  onSend: vi.fn(),
  onOpenCommands: vi.fn(),
  commandValue: null,
  onCommandValueUsed: vi.fn(),
};

describe("ChatInput", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it("renders textarea with placeholder", () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByPlaceholderText("Send a message...")).toBeInTheDocument();
  });

  it("renders commands button", () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByLabelText("Open commands")).toBeInTheDocument();
  });

  it("renders send button", () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByLabelText("Send")).toBeInTheDocument();
  });

  it("calls onSend when Enter is pressed with text", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Send a message...");
    await user.type(textarea, "hello world{Enter}");

    expect(onSend).toHaveBeenCalledWith("hello world");
  });

  it("does not call onSend on Enter with empty input", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Send a message...");
    await user.click(textarea);
    await user.keyboard("{Enter}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears input after sending", async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    const textarea = screen.getByPlaceholderText("Send a message...") as HTMLTextAreaElement;
    await user.type(textarea, "hello{Enter}");

    expect(textarea.value).toBe("");
  });

  it("calls onOpenCommands when commands button is clicked", async () => {
    const onOpenCommands = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} onOpenCommands={onOpenCommands} />);

    await user.click(screen.getByLabelText("Open commands"));
    expect(onOpenCommands).toHaveBeenCalledTimes(1);
  });

  it("fills input from commandValue prop", () => {
    render(<ChatInput {...defaultProps} commandValue="/help " />);
    const textarea = screen.getByPlaceholderText("Send a message...") as HTMLTextAreaElement;
    expect(textarea.value).toBe("/help ");
  });

  it("calls onCommandValueUsed after filling from commandValue", () => {
    const onCommandValueUsed = vi.fn();
    render(<ChatInput {...defaultProps} commandValue="/status " onCommandValueUsed={onCommandValueUsed} />);
    expect(onCommandValueUsed).toHaveBeenCalledTimes(1);
  });

  it("shows command suggestions when typing /", async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    const textarea = screen.getByPlaceholderText("Send a message...");
    await user.type(textarea, "/he");

    // Should show /help in suggestions (text is inside a nested span)
    expect(await screen.findByText("/help")).toBeInTheDocument();
  });
});
