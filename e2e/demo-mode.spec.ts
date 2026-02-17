import { test, expect } from "@playwright/test";

// Helper to type into the chat input via JS (avoids CSS pointer-events issues)
async function sendChatMessage(page: import("@playwright/test").Page, text: string) {
  // Use evaluate to set value directly and dispatch events, working around CSS var animations
  await page.evaluate((msg) => {
    const textarea = document.querySelector('textarea[placeholder="Send a message..."]') as HTMLTextAreaElement;
    if (!textarea) throw new Error("Chat textarea not found");
    // Focus and set value via native setter to trigger React's onChange
    textarea.focus();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    nativeInputValueSetter?.call(textarea, msg);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }, text);

  // Small wait for React state to settle
  await page.waitForTimeout(200);

  // Submit via Enter key
  await page.evaluate(() => {
    const textarea = document.querySelector('textarea[placeholder="Send a message..."]') as HTMLTextAreaElement;
    if (!textarea) return;
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })
    );
  });
}

test.describe("Demo Mode", () => {
  test("loads demo mode via ?demo URL param", async ({ page }) => {
    await page.goto("/?demo");

    // Should show demo history messages
    await expect(page.getByText("Welcome to MobileClaw demo mode")).toBeVisible({ timeout: 15_000 });
  });

  test("shows chat input", async ({ page }) => {
    await page.goto("/?demo");

    await expect(page.getByPlaceholder("Send a message...")).toBeVisible({ timeout: 15_000 });
  });

  test("can send a message and receive a demo response", async ({ page }) => {
    await page.goto("/?demo");

    // Wait for app to be ready
    await expect(page.getByPlaceholder("Send a message...")).toBeVisible({ timeout: 15_000 });

    await sendChatMessage(page, "help");

    // Should get a demo response with the help content
    await expect(page.getByText("Demo Mode Commands")).toBeVisible({ timeout: 45_000 });
  });

  test("demo history contains expected messages", async ({ page }) => {
    await page.goto("/?demo");

    // Check that history messages are visible
    await expect(page.getByText("What can you do?")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Write me a fibonacci function")).toBeVisible({ timeout: 5_000 });
  });

  test("shows setup dialog when no demo param", async ({ page }) => {
    await page.goto("/");

    // Setup dialog should be visible
    await expect(page.getByText("Connect to MobileClaw")).toBeVisible({ timeout: 15_000 });
  });

  test("setup dialog has Start Demo button when URL is cleared", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Connect to MobileClaw")).toBeVisible({ timeout: 15_000 });

    // Clear the URL field via JS to reliably get "Start Demo" button
    await page.evaluate(() => {
      const input = document.getElementById("openclaw-url") as HTMLInputElement;
      if (!input) return;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeSetter?.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await expect(page.getByText("Start Demo")).toBeVisible({ timeout: 5_000 });
  });

  test("can enter demo mode from setup dialog", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Connect to MobileClaw")).toBeVisible({ timeout: 15_000 });

    // Clear URL via JS
    await page.evaluate(() => {
      const input = document.getElementById("openclaw-url") as HTMLInputElement;
      if (!input) return;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeSetter?.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await page.getByText("Start Demo").click();

    // Should eventually show demo history
    await expect(page.getByText("Welcome to MobileClaw demo mode")).toBeVisible({ timeout: 15_000 });
  });

  test("weather keyword triggers streaming response", async ({ page }) => {
    await page.goto("/?demo");

    await expect(page.getByPlaceholder("Send a message...")).toBeVisible({ timeout: 15_000 });

    await sendChatMessage(page, "weather");

    // Should eventually show weather response text
    await expect(page.getByText("San Francisco")).toBeVisible({ timeout: 45_000 });
  });

  test("commands button is present", async ({ page }) => {
    await page.goto("/?demo");

    await expect(page.getByPlaceholder("Send a message...")).toBeVisible({ timeout: 15_000 });

    // Verify commands button exists and is accessible
    await expect(page.getByLabel("Open commands")).toBeAttached();
  });
});
