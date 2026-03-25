import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";

import { NotificationCardInner } from "@mc/plugins/app/notificationCard";

const clientHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientHeight",
);
const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollHeight",
);
const clientWidthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientWidth",
);
const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollWidth",
);

function restoreDescriptor(
  key: "clientHeight" | "scrollHeight" | "clientWidth" | "scrollWidth",
  descriptor?: PropertyDescriptor,
) {
  if (descriptor) {
    Object.defineProperty(HTMLElement.prototype, key, descriptor);
    return;
  }
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
}

describe("NotificationCardInner", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        const text = this.textContent ?? "";
        const className = typeof this.className === "string" ? this.className : "";

        if (text.includes("Long question")) {
          return className.includes("line-clamp-3") ? 60 : 120;
        }

        if (text.includes("Long context")) {
          return className.includes("line-clamp-2") ? 40 : 90;
        }

        return 40;
      },
    });

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        const text = this.textContent ?? "";

        if (text.includes("Long question")) return 120;
        if (text.includes("Long context")) return 90;
        return 40;
      },
    });

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 200;
      },
    });

    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return 200;
      },
    });
  });

  afterEach(() => {
    restoreDescriptor("clientHeight", clientHeightDescriptor);
    restoreDescriptor("scrollHeight", scrollHeightDescriptor);
    restoreDescriptor("clientWidth", clientWidthDescriptor);
    restoreDescriptor("scrollWidth", scrollWidthDescriptor);
  });

  function renderCard(props?: Partial<ComponentProps<typeof NotificationCardInner>>) {
    return render(
      <NotificationCardInner
        question="Short question"
        context="Short context"
        urgency="low"
        createdAt={Date.now()}
        options={[]}
        {...props}
      />,
    );
  }

  it("hides the toggle when neither field is truncated", async () => {
    renderCard();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Show more" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows the toggle when the question is truncated", async () => {
    renderCard({ question: "Long question" });

    const button = await screen.findByRole("button", { name: "Show more" });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
  });

  it("shows the toggle when the context is truncated", async () => {
    renderCard({ context: "Long context" });

    expect(await screen.findByRole("button", { name: "Show more" })).toBeInTheDocument();
  });
});
