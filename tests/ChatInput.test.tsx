import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "@/components/ChatInput";

const defaultProps = {
  onSend: vi.fn(),
};

describe("ChatInput", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it("renders textarea with placeholder", () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByPlaceholderText("Send a message...")).toBeInTheDocument();
  });

  it("renders image picker button", () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByLabelText("Attach image")).toBeInTheDocument();
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

    expect(onSend).toHaveBeenCalledWith("hello world", undefined);
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

  it("shows command suggestions when typing /", async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    const textarea = screen.getByPlaceholderText("Send a message...");
    await user.type(textarea, "/he");

    // Should show /help in suggestions (text is inside a nested span)
    expect(await screen.findByText("/help")).toBeInTheDocument();
  });
});
