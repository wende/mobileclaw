import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { NotificationCardInner } from "@mc/plugins/app/notificationCard";

describe("NotificationCardInner", () => {
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

  it("renders the question text", () => {
    renderCard();
    expect(screen.getByText("Short question")).toBeInTheDocument();
  });

  it("renders context when provided", () => {
    renderCard({ context: "Long context" });
    expect(screen.getByText("Long context")).toBeInTheDocument();
  });

  it("renders question and context together", () => {
    renderCard({ question: "Long question", context: "Long context" });
    expect(screen.getByText("Long question")).toBeInTheDocument();
    expect(screen.getByText("Long context")).toBeInTheDocument();
  });
});
