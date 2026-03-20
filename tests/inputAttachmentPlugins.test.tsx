import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { imageAttachmentPlugin, fileAttachmentPlugin, quoteAttachmentPlugin } from "@/lib/plugins/inputAttachmentBuiltins";
import { promptContextAttachmentPlugin } from "@/plugins/app/contextChip";

describe("imageAttachmentPlugin", () => {
  it("renders a thumbnail preview", () => {
    const { container } = render(
      <>{imageAttachmentPlugin.renderPreview({
        data: { mimeType: "image/png", fileName: "photo.png", content: "abc", previewUrl: "blob:img" },
        onRemove: () => {},
        onLightbox: () => {},
      })}</>
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("blob:img");
    expect(img!.getAttribute("alt")).toBe("photo.png");
  });

  it("contributes an ImageAttachment on send", () => {
    const c = imageAttachmentPlugin.toSendContribution({
      mimeType: "image/png", fileName: "photo.png", content: "abc", previewUrl: "blob:img",
    });
    expect(c.images).toHaveLength(1);
    expect(c.images![0].mimeType).toBe("image/png");
    expect(c.textPrefix).toBeUndefined();
  });
});

describe("fileAttachmentPlugin", () => {
  it("renders file name in preview", () => {
    render(
      <>{fileAttachmentPlugin.renderPreview({
        data: { mimeType: "text/plain", fileName: "readme.txt", content: "abc", previewUrl: "blob:f" },
        onRemove: () => {},
      })}</>
    );
    expect(screen.getByText("readme.txt")).toBeInTheDocument();
  });

  it("contributes an ImageAttachment on send", () => {
    const c = fileAttachmentPlugin.toSendContribution({
      mimeType: "text/plain", fileName: "readme.txt", content: "abc", previewUrl: "blob:f",
    });
    expect(c.images).toHaveLength(1);
    expect(c.images![0].fileName).toBe("readme.txt");
  });
});

describe("quoteAttachmentPlugin", () => {
  it("renders quoted text in preview", () => {
    render(
      <>{quoteAttachmentPlugin.renderPreview({
        data: { text: "some quoted text" },
        onRemove: () => {},
      })}</>
    );
    expect(screen.getByText("some quoted text")).toBeInTheDocument();
  });

  it("contributes a textPrefix with > syntax on send", () => {
    const c = quoteAttachmentPlugin.toSendContribution({ text: "line one\nline two" });
    expect(c.textPrefix).toBe("> line one\n> line two");
    expect(c.images).toBeUndefined();
  });
});

describe("promptContextAttachmentPlugin", () => {
  it("renders label in preview chip", () => {
    render(
      <>{promptContextAttachmentPlugin.renderPreview({
        data: { label: "API docs", context: "REST endpoints..." },
        onRemove: () => {},
      })}</>
    );
    expect(screen.getByText("API docs")).toBeInTheDocument();
  });

  it("contributes a textPrefix with context header syntax on send", () => {
    const c = promptContextAttachmentPlugin.toSendContribution({
      label: "Brief",
      context: "First line\nSecond line",
    });
    expect(c.textPrefix).toBe("> [context: Brief]\n> First line\n> Second line");
    expect(c.images).toBeUndefined();
  });
});
