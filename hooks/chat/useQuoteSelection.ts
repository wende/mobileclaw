import { useState, useRef, useEffect, useCallback } from "react";

interface UseQuoteSelectionOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function useQuoteSelection({ scrollRef }: UseQuoteSelectionOptions) {
  const [quoteText, setQuoteText] = useState<string | null>(null);
  const [quotePopup, setQuotePopup] = useState<{ x: number; y: number; text: string } | null>(null);
  const quotePopupRef = useRef<HTMLButtonElement>(null);

  const checkSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setQuotePopup(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const container = scrollRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) {
      setQuotePopup(null);
      return;
    }

    let node: Node | null = range.commonAncestorContainer;
    while (node && node !== container) {
      if (node instanceof HTMLElement && node.dataset.messageRole === "assistant") {
        const rect = range.getBoundingClientRect();
        setQuotePopup({
          x: Math.max(40, Math.min(rect.left + rect.width / 2, window.innerWidth - 40)),
          y: rect.top,
          text: sel.toString().trim(),
        });
        return;
      }
      node = node.parentNode;
    }
    setQuotePopup(null);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => setTimeout(checkSelection, 10);
    el.addEventListener("pointerup", handler);
    return () => el.removeEventListener("pointerup", handler);
  }, [scrollRef, checkSelection]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handler = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) setQuotePopup(null);
        else checkSelection();
      }, 200);
    };
    document.addEventListener("selectionchange", handler);
    return () => {
      document.removeEventListener("selectionchange", handler);
      clearTimeout(timeout);
    };
  }, [checkSelection]);

  useEffect(() => {
    if (!quotePopup) return;
    const handler = (e: PointerEvent) => {
      if (quotePopupRef.current?.contains(e.target as Node)) return;
      setQuotePopup(null);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [quotePopup]);

  const handleAcceptQuote = useCallback((text: string) => {
    setQuoteText(text);
    setQuotePopup(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  return {
    quoteText,
    setQuoteText,
    quotePopup,
    quotePopupRef,
    handleAcceptQuote,
  };
}
