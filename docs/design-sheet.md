# MobileClaw Design Sheet

## 1. Visual Vibe

MobileClaw feels like a calm, tactile, mobile-first control surface:

- neutral and low-noise (grayscale-first, minimal hue usage)
- soft depth instead of hard contrast (layered cards, blur, translucent surfaces)
- rounded, pill-driven geometry (squircles + chips + sheet handles)
- kinetic but restrained motion (short fades, slide reveals, smooth morphing)
- chat-first readability (larger body scale, generous line-height, strong hierarchy in metadata)

Keywords: `minimal`, `soft-tech`, `focused`, `touch-native`, `quietly animated`.

## 2. Palette

### Core Theme Tokens (OKLCH)

| Role | Light | Dark | Usage |
| --- | --- | --- | --- |
| `--background` | `oklch(0.985 0 0)` | `oklch(0.166 0 0)` | app canvas |
| `--foreground` | `oklch(0.164 0 0)` | `oklch(0.911 0 0)` | primary text/icons |
| `--card` | `oklch(1 0 0)` | `oklch(0.194 0 0)` | cards, bubbles, controls |
| `--popover` | `oklch(1 0 0)` | `oklch(0.224 0 0)` | overlays/modals |
| `--primary` | `oklch(0.164 0 0)` | `oklch(0.258 0 0)` | CTA/send surfaces |
| `--secondary` | `oklch(0.96 0 0)` | `oklch(0.194 0 0)` | muted surfaces |
| `--muted-foreground` | `oklch(0.45 0 0)` | `oklch(0.632 0 0)` | metadata/secondary copy |
| `--border` | `oklch(0.915 0 0)` | `oklch(0.224 0 0)` | separators + outlines |
| `--ring` | `oklch(0.708 0 0)` | `oklch(0.35 0 0)` | focus rings |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.396 0.12 25.723)` | errors/abort states |

### Accent Usage Pattern

- Palette is intentionally achromatic across most of the UI.
- Color appears mainly in:
  - status dots (`green`, `yellow`, `red`, `blue`)
  - destructive states
  - code diff highlights in tool pills
- This keeps the conversational surface visually quiet while preserving clear state signaling.

### Notable Exceptions to Token Purity

A few components deliberately use non-OKLCH values for effect:

- `ImageLightbox`: `bg-black/80`, `bg-white/10`
- shadows: `rgba(...)` drop shadows for depth
- connection/status dots: Tailwind semantic colors (`bg-green-500`, etc.)

## 3. Typography

### Font Stack

- Sans: `Google Sans Flex` -> Geist Sans fallback chain
- Mono: Geist Mono stack

### Type Scale (custom Tailwind theme)

- `text-2xs`: 12px / 16px
- `text-xs`: 14px / 20px
- `text-sm`: 16px / 24px (base body)
- `text-base`: 18px / 28px
- `text-lg`: 20px / 28px
- `text-xl`: 22px / 30px

### Readability Decisions

- Chat content commonly uses `text-sm` with `leading-[1.75rem]` for easier long-form scanning.
- Metadata and chrome are mostly `text-xs` and `text-2xs` with muted contrast.

## 4. Shape Language

### Core Geometry

- Global radius token: `--radius: 0.75rem` (12px)
- Common radii: `rounded-lg`, `rounded-xl`, `rounded-2xl`
- Sheet handles and tiny metadata chips reinforce a "pill/chip" motif.

### Signature Shape

- `SQUIRCLE_RADIUS = 26` is used for:
  - user message bubbles
  - tool call bubbles
  - morphing composer glass surface
- This gives MobileClaw a distinct soft-rect silhouette beyond standard Tailwind rounding.

### Layout Proportions

- Message bubble max width: `85%` (mobile), `75%` on `md`
- Composer action buttons: `40x40`
- Header icon buttons: `32x32`
- Bottom sheets: `max-h-[70dvh]`, rounded top corners

## 5. Component Styling System

### App Shell

- Full-height viewport (`100dvh`) with hidden body overflow.
- Header is translucent (`card @ 70% alpha`) with blur and thin border.
- Message viewport uses subtle top/bottom gradients to blend with fixed composer.

### Messages

- User messages: filled primary-toned squircle bubble with slight border + shadow.
- Assistant messages: mostly unboxed text blocks, with structured content rendered as pills.
- System/context/tool payloads: compact rounded pills, expandable via chevron/slide.

### Composer

- Morphing input-to-pill behavior driven by CSS vars `--sp` (scroll progress) and `--lp`.
- Liquid-glass effect:
  - desktop: SVG filter displacement + specular map
  - mobile: blur+saturate fallback for compatibility
- Attachments, quote preview, and send/queue/stop states are stacked inside one shared glass surface.

### Overlays and Sheets

- Setup dialog: centered card with blur backdrop and scale/translate entrance.
- Session/command/model pickers: bottom sheets with drag-handle idiom and blurred scrim.
- Visual language stays consistent: `border + muted bg + rounded-xl + soft hover accent`.

## 6. Motion Language

### Motion Traits

- Mostly 200-300ms transitions (`ease-out`) for UI state changes.
- Streaming/arrival effects are fast and subtle (fade, tiny scale pop, slide-open grids).
- No heavy spring choreography; movement is functional and legible.

### Key Motion Primitives

- `fadeIn`: generic reveal for rows/overlays
- `messageSend`: user bubble pop (`350ms` cubic-bezier overshoot)
- `gridSlideOpen`: expandable panel reveal
- `dotFade`: animated thinking ellipsis
- `compactShrink` / `compactArrows`: compacting indicator icon
- `spin`: loading and reconnect loops

### Scroll-Coupled Motion

- Composer morph responds continuously to scroll distance (60fps via custom property interpolation).
- Streaming auto-scroll uses momentum-style rAF behavior to feel native on mobile.

## 7. Iconography and Detail Tone

- All icons are inline SVG, mostly 1.5-2px strokes, rounded caps/joins.
- Many icons run at 10-16px to keep chrome compact.
- Opacity layering (`opacity-30` to `opacity-70`) is heavily used instead of extra colors.

## 8. Practical Vibe Summary

If this style evolves, preserve these anchors:

1. grayscale-first palette with selective semantic color
2. squircle/pill geometry as the primary shape motif
3. soft depth (blur + translucent surfaces) over hard contrast
4. concise, utility motion that supports chat flow
5. mobile ergonomics first, desktop as a wider variant
