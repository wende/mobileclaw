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

    test("strong manual scroll-up during streaming disables forced autoscroll", async ({ page }) => {
        await page.goto("/?demo");
        await expect(page.getByPlaceholder("Send a message...")).toBeVisible({ timeout: 15_000 });

        await sendChatMessage(page, "long");
        await expect(page.getByPlaceholder("Queue a message...")).toBeVisible({ timeout: 20_000 });

        await page.waitForFunction(() => {
            const el = document.querySelector("main");
            return !!el && el.scrollHeight - el.clientHeight > 300;
        }, { timeout: 20_000 });

        await page.evaluate(() => {
            const el = document.querySelector("main");
            if (!el) return;
            for (let i = 0; i < 6; i++) {
                el.dispatchEvent(new WheelEvent("wheel", { deltaY: -20, bubbles: true, cancelable: true }));
            }
            el.scrollTop = Math.max(0, el.scrollTop - 260);
        });

        await page.waitForTimeout(300);
        const distAfterManualScroll = await getDistFromBottom(page);
        expect(distAfterManualScroll, `Expected to be away from bottom after manual scroll, got ${distAfterManualScroll}px`).toBeGreaterThan(120);

        await page.waitForTimeout(1500);
        const distAfterMoreStreaming = await getDistFromBottom(page);
        expect(distAfterMoreStreaming, `Expected autoscroll to stay disabled while streaming, got ${distAfterMoreStreaming}px`).toBeGreaterThan(100);
    });

    test("end-of-stream: scroll reaches bottom, pill hidden, no bounce", { tag: "@headed" }, async ({ page }) => {
        await page.goto("/?demo");
        await expect(page.getByPlaceholder("Send a message...")).toBeVisible({ timeout: 15_000 });

        // "scroll-test" is a text-only response with thinking block that
        // generates enough content to require scrolling.
        await sendChatMessage(page, "scroll-test");

        // Wait for streaming to finish
        await expect(page.getByText("Scroll test done.")).toBeVisible({ timeout: 15_000 });

        // Sample the transform on the content div rapidly during the grace
        // period (500ms after streaming ends). The momentum bounce bug causes
        // a translateY transform to appear here.
        const bounceDetected = await page.evaluate(() => {
            return new Promise<boolean>((resolve) => {
                const main = document.querySelector("main");
                const content = main?.firstElementChild as HTMLElement | null;
                if (!content) { resolve(false); return; }
                let detected = false;
                let checks = 0;
                const interval = setInterval(() => {
                    const t = content.style.transform;
                    if (t && t !== "" && t !== "none") detected = true;
                    checks++;
                    if (checks > 60) { // ~1 second at 60fps
                        clearInterval(interval);
                        resolve(detected);
                    }
                }, 16);
            });
        });
        expect(bounceDetected, "Content div should not bounce (translateY) after streaming ends").toBe(false);

        // Wait for full settle
        await page.waitForTimeout(1000);

        // Scroll should be at the bottom
        const dist = await getDistFromBottom(page);
        expect(dist, `Expected scroll at bottom, but dist was ${dist}px`).toBeLessThan(5);

        // Morph bar pill should be hidden (--sp ≈ 0)
        const sp = await page.evaluate(() => {
            const morph = document.querySelector('[class*="pointer-events-auto"]');
            if (!morph) return "0";
            return getComputedStyle(morph).getPropertyValue("--sp").trim();
        });
        expect(
            parseFloat(sp) || 0,
            `Expected --sp to be 0 (pill hidden), but was ${sp}`
        ).toBeLessThan(0.05);
    });
});
