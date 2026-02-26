# Header Blur Gradient Attempts

**Date:** 2026-02-26
**Outcome:** Reverted to original solid header. Progressive blur is not feasible with pure CSS.

## Goal

Make the ChatHeader fade gradually from opaque at the top to transparent at the bottom, removing the hard bottom border edge.

## Attempts

### 1. CSS mask on header element
Applied `mask-image: linear-gradient(to bottom, black 60%, transparent)` directly on the `<header>` which had `backdrop-blur-sm` and a background color.

**Problem:** The mask affects both the background color AND `backdrop-filter` equally. The blur cuts off abruptly where the mask fades, creating a visible hard edge — worse than the original border.

### 2. Separate blur and color layers
Split into two absolute child divs inside the header:
- Blur layer: `backdrop-filter: blur(8px)` with its own gentle mask
- Color layer: `background` with a more aggressive mask

**Problem:** `backdrop-filter` on an absolute child inside the header didn't work at all — no blur was visible. The `backdrop-filter` needs to be on an element that's directly composited over the content it's blurring, and nesting inside another positioned element breaks this.

### 3. Blur on header + masked color overlay child
Put `backdrop-blur-sm` on the header itself (no mask), with a single masked child div for just the color overlay.

**Problem:** The uniform blur across the full header area visually overpowers the color gradient. The frosted glass effect is so strong that the fading color overlay is imperceptible.

### 4. Combined blur + color on single masked child
One absolute child with `-z-10`, both `backdrop-filter` and `background` on the same element, masked together.

**Problem:** Same as attempt 1 — blur and color fade together, creating the same hard blur cutoff edge.

## Conclusion

CSS `backdrop-filter` does not support gradual intensity. It's binary — either blurring or not. The only way to achieve progressive blur would be:
- Stacked blur layers (multiple elements with increasing blur values and stepped masks) — heavy on GPU
- Canvas-based blur — too complex for a header
- SVG filter with `feGaussianBlur` gradient — poor browser support for animated/interactive content

Reverted to the original clean header: `backdrop-blur-sm` + solid `oklch` background at 0.7 opacity + subtle `border-b border-border/50`.
