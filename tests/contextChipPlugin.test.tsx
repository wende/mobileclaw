import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageRow } from "@mc/components/MessageRow";
import type { Message } from "@mc/types/chat";
import { contextChipPlugin } from "@mc/plugins/app/contextChip";

describe("contextChipPlugin parse", () => {
  it("parses valid data", () => {
    const result = contextChipPlugin.parse({ label: "Docs", context: "Some context", description: "A note" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.label).toBe("Docs");
      expect(result.value.context).toBe("Some context");
      expect(result.value.description).toBe("A note");
    }
  });

  it("rejects missing label", () => {
    const result = contextChipPlugin.parse({ context: "Some context" });
    expect(result.ok).toBe(false);
  });

  it("rejects missing context", () => {
    const result = contextChipPlugin.parse({ label: "Docs" });
    expect(result.ok).toBe(false);
  });

  it("rejects non-object", () => {
    expect(contextChipPlugin.parse(null).ok).toBe(false);
    expect(contextChipPlugin.parse("string").ok).toBe(false);
  });
});

describe("context_chip message plugin rendering", () => {
  it("renders context chip with label and Attach button", () => {
    const message: Message = {
      role: "assistant",
      content: [
        {
          type: "plugin",
          partId: "ctx-1",
          pluginType: "context_chip",
          state: "settled",
          data: { label: "Project brief", context: "MobileClaw is cool", description: "Attach this" },
        },
      ],
      id: "ctx-msg",
    };

    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByTestId("context-chip")).toBeInTheDocument();
    expect(screen.getByText("Project brief")).toBeInTheDocument();
    expect(screen.getByText("Attach this")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach" })).toBeInTheDocument();
  });

  it("calls addInputAttachment and shows Added state on click", () => {
    const addInputAttachment = vi.fn();
    const message: Message = {
      role: "assistant",
      content: [
        {
          type: "plugin",
          partId: "ctx-2",
          pluginType: "context_chip",
          state: "settled",
          data: { label: "Brief", context: "Content here" },
        },
      ],
      id: "ctx-msg-2",
    };

    render(<MessageRow message={message} isStreaming={false} onAddInputAttachment={addInputAttachment} />);
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    expect(addInputAttachment).toHaveBeenCalledWith("prompt_context", { label: "Brief", context: "Content here" });
    expect(screen.getByRole("button", { name: "Added" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Added" })).toBeDisabled();
  });

  it("does not render Attach button in tombstone state", () => {
    const message: Message = {
      role: "assistant",
      content: [
        {
          type: "plugin",
          partId: "ctx-3",
          pluginType: "context_chip",
          state: "tombstone",
          data: { label: "Old", context: "Gone" },
        },
      ],
      id: "ctx-msg-3",
    };

    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach" })).not.toBeInTheDocument();
  });
});

describe("UserTextWithQuotes context rendering", () => {
  it("renders context block with label and truncated body in user messages", () => {
    const message: Message = {
      role: "user",
      content: [{ type: "text", text: "> [context: API docs]\n> REST endpoints for the service\n\n\nPlease review this" }],
      id: "user-ctx",
    };

    render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText("API docs")).toBeInTheDocument();
    expect(screen.getByText("REST endpoints for the service")).toBeInTheDocument();
    expect(screen.getByText("Please review this")).toBeInTheDocument();
  });

  it("renders regular quotes with left border, not as context chips", () => {
    const message: Message = {
      role: "user",
      content: [{ type: "text", text: "> A normal quote\n\n\nMy reply" }],
      id: "user-quote",
    };

    const { container } = render(<MessageRow message={message} isStreaming={false} />);
    expect(screen.getByText("A normal quote")).toBeInTheDocument();
    expect(screen.getByText("My reply")).toBeInTheDocument();
    // Regular quote uses border-l-2, not the rounded card
    expect(container.querySelector(".border-l-2")).not.toBeNull();
  });
});
