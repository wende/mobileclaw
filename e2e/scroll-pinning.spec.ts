import { test, expect } from "@playwright/test";

// Helper to type into the chat input via JS (avoids CSS pointer-events issues)
async function sendChatMessage(page: import("@playwright/test").Page, text: string) {
    await page.evaluate((msg) => {
        const textarea = document.querySelector('textarea[placeholder="Send a message..."]') as HTMLTextAreaElement;
        if (!textarea) throw new Error("Chat textarea not found");
        textarea.focus();
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            "value"
        )?.set;
        nativeInputValueSetter?.call(textarea, msg);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }, text);

    await page.waitForTimeout(200);

    await page.evaluate(() => {
        const textarea = document.querySelector('textarea[placeholder="Send a message..."]') as HTMLTextAreaElement;
        if (!textarea) return;
        textarea.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })
        );
    });
}

/** Read the scroll distance from the bottom of the main element. */
async function getDistFromBottom(page: import("@playwright/test").Page): Promise<number> {
    return page.evaluate(() => {
        const el = document.querySelector("main");
        if (!el) return -1;
        return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
    });
}

test.describe("Scroll Pinning", () => {
    test("stays pinned to bottom during weather response with markdown table", async ({ page }) => {
        await page.goto("/?demo");
        await expect(page.getByPlaceholder("Send a message...")).toBeVisible({ timeout: 15_000 });

        await sendChatMessage(page, "weather");

        // Wait for the markdown table to appear (this is the layout-shift trigger)
        await expect(page.locator("table")).toBeVisible({ timeout: 45_000 });

        // Wait for the full response to finish (final sentence after the table)
        await expect(page.getByText("Karl the Fog")).toBeVisible({ timeout: 45_000 });

        // Give the typewriter + scroll a moment to settle
        await page.waitForTimeout(1_000);

        // The view should be pinned to the bottom (dist < 80px threshold)
        const dist = await getDistFromBottom(page);
        expect(dist, `Expected scroll to be at bottom, but dist was ${dist}px`).toBeLessThan(80);
    });

    test("stays pinned to bottom during code response", async ({ page }) => {
        await page.goto("/?demo");
        await expect(page.getByPlaceholder("Send a message...")).toBeVisible({ timeout: 15_000 });

        await sendChatMessage(page, "code");

        // Wait for the code block to render
        await expect(page.locator("pre code")).toBeVisible({ timeout: 45_000 });

        // Wait for the full response
        await expect(page.getByText("Hello from MobileClaw")).toBeVisible({ timeout: 45_000 });

        await page.waitForTimeout(1_000);

        const dist = await getDistFromBottom(page);
        expect(dist, `Expected scroll to be at bottom, but dist was ${dist}px`).toBeLessThan(80);
    });

    test("scroll-to-bottom pill is hidden when pinned", async ({ page }) => {
        await page.goto("/?demo");
        await expect(page.getByPlaceholder("Send a message...")).toBeVisible({ timeout: 15_000 });

        await sendChatMessage(page, "weather");

        // Wait for the full response including the table
        await expect(page.getByText("Karl the Fog")).toBeVisible({ timeout: 45_000 });
        await page.waitForTimeout(1_000);

        // The "Scroll to bottom" pill should NOT be visible (opacity ~0 when --sp is 0)
        // We check via computed style since it uses CSS var opacity
        const pillOpacity = await page.evaluate(() => {
            // The pill overlay is the child with "Scroll to bottom" text
            const pill = Array.from(document.querySelectorAll("span")).find(
                (el) => el.textContent === "Scroll to bottom"
            );
            if (!pill) return 0;
            const container = pill.closest("[style*='--sp']");
            if (!container) return 0;
            return parseFloat(getComputedStyle(pill.parentElement!).opacity);
        });

        expect(pillOpacity, "Scroll-to-bottom pill should be hidden").toBeLessThan(0.1);
    });
});
