import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Shared expand/collapse animation logic for panels that animate both
 * width (narrow pill → wide content) and height (grid 0fr → 1fr).
 *
 * Used by InjectedPill and ContextPill in MessageRow.tsx.
 */
export function useExpandablePanel() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const outerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const narrowWidthRef = useRef(0);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Open: lock narrow width → mount content → measure → animate width + height
  // Close: animate height → unmount content → release width
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    if (open) {
      narrowWidthRef.current = Math.ceil(el.getBoundingClientRect().width);
      el.style.width = `${narrowWidthRef.current}px`;
      setMounted(true);
    } else {
      if (mounted) {
        el.style.width = `${el.offsetWidth}px`;
        void el.offsetWidth;
        el.style.width = `${narrowWidthRef.current}px`;
        setExpanded(false);
        const t = setTimeout(() => {
          setMounted(false);
          el.style.width = "";
        }, 220);
        return () => clearTimeout(t);
      }
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mounted && open) {
      const el = outerRef.current;
      if (!el) return;
      const raf = requestAnimationFrame(() => {
        el.style.width = "";
        const targetWidth = el.scrollWidth;
        // Pin content at target width so text doesn't reflow during animation
        if (contentRef.current) contentRef.current.style.minWidth = `${targetWidth}px`;
        el.style.width = `${narrowWidthRef.current}px`;
        void el.offsetWidth;
        el.style.width = `${targetWidth}px`;
        setExpanded(true);
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [mounted, open]);

  // After expand transition, release explicit width so container reflows naturally
  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.propertyName === "width" && open && outerRef.current) {
      outerRef.current.style.width = "";
    }
  }, [open]);

  return { open, toggle, mounted, expanded, outerRef, contentRef, handleTransitionEnd };
}
