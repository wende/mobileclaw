"use client";

import { useState, useRef, useEffect } from "react";
import { MarkdownContent, StreamingCursor } from "@/components/markdown/MarkdownContent";

// Typewriter effect: gradually reveals text character-by-character
export function StreamingText({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [displayLen, setDisplayLen] = useState(text.length);
  const targetLenRef = useRef(text.length);
  const rafRef = useRef<number | null>(null);
  const prevTextRef = useRef(text);

  // When text grows, keep displayLen where it was and let the animation catch up
  useEffect(() => {
    targetLenRef.current = text.length;
    // If text changed by replacement (e.g. history reload), snap immediately
    if (!text.startsWith(prevTextRef.current.slice(0, displayLen))) {
      setDisplayLen(text.length);
    }
    prevTextRef.current = text;
  }, [text]);

  // When not streaming, snap to full length
  useEffect(() => {
    if (!isStreaming) {
      setDisplayLen(text.length);
      targetLenRef.current = text.length;
    }
  }, [isStreaming, text.length]);

  // rAF loop to animate displayLen towards target
  useEffect(() => {
    if (!isStreaming) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const tick = () => {
      setDisplayLen((prev) => {
        const target = targetLenRef.current;
        if (prev >= target) return prev;
        // Reveal ~3 chars per frame (~180 chars/sec at 60fps) + close 30% of remaining gap
        const gap = target - prev;
        const step = Math.max(3, Math.ceil(gap * 0.3));
        return Math.min(prev + step, target);
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isStreaming]);

  const visibleText = text.slice(0, displayLen);
  return (
    <>
      <MarkdownContent text={visibleText} />
      {isStreaming && <StreamingCursor />}
    </>
  );
}
