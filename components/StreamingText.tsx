"use client";

import { useState, useRef, useEffect } from "react";
import { MarkdownContent, BlockCursor, StreamingCursor } from "@/components/markdown/MarkdownContent";

// Module-level: remembered rate from previous responses (persists across component instances)
let learnedCharsPerMs = 0.15; // Default: ~150 chars/sec, learned from history

// Smooth typewriter effect: reveals text at a pace extrapolated from previous responses
export function StreamingText({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [displayLen, setDisplayLen] = useState(text.length);
  const targetLenRef = useRef(text.length);
  const rafRef = useRef<number | null>(null);
  const prevTextRef = useRef(text);
  const prevTextLenRef = useRef(text.length);

  // Track delta timing to calculate animation speed
  const deltaTimesRef = useRef<{ time: number; chars: number }[]>([]);
  const charsPerMsRef = useRef(learnedCharsPerMs); // Start with learned rate
  const lastFrameTimeRef = useRef(0);
  const fractionalCharsRef = useRef(0); // Accumulate sub-char progress

  // Cursor fades out after 3s of no movement
  const [cursorStale, setCursorStale] = useState(false);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When text grows, record the delta and let animation catch up
  useEffect(() => {
    const now = performance.now();
    const deltaChars = text.length - prevTextLenRef.current;

    targetLenRef.current = text.length;

    // If text changed by replacement (e.g. history reload), snap immediately
    if (!text.startsWith(prevTextRef.current.slice(0, displayLen))) {
      setDisplayLen(text.length);
      deltaTimesRef.current = [];
      charsPerMsRef.current = learnedCharsPerMs;
    } else if (deltaChars > 0) {
      // Record this delta for rate calculation
      deltaTimesRef.current.push({ time: now, chars: deltaChars });

      // Keep only last 10 deltas for averaging (rolling window)
      if (deltaTimesRef.current.length > 10) {
        deltaTimesRef.current.shift();
      }

      // Calculate average chars/ms from recent deltas
      if (deltaTimesRef.current.length >= 2) {
        const deltas = deltaTimesRef.current;
        const timeSpan = deltas[deltas.length - 1].time - deltas[0].time;
        const totalChars = deltas.slice(1).reduce((sum, d) => sum + d.chars, 0);

        if (timeSpan > 0) {
          // Calculate incoming rate and add 20% buffer for smooth catch-up
          const incomingRate = totalChars / timeSpan;
          // Blend with current rate for stability (exponential smoothing)
          charsPerMsRef.current = charsPerMsRef.current * 0.7 + incomingRate * 1.2 * 0.3;
          // Clamp to reasonable bounds: 30-500 chars/sec
          charsPerMsRef.current = Math.max(0.03, Math.min(0.5, charsPerMsRef.current));
        }
      }
    }

    prevTextRef.current = text;
    prevTextLenRef.current = text.length;
  }, [text, displayLen]);

  // Track streaming state transitions
  const wasStreamingRef = useRef(isStreaming);

  // When streaming starts, initialize with learned rate from previous responses
  useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      // New stream starting - use the extrapolated rate from history
      charsPerMsRef.current = learnedCharsPerMs;
      deltaTimesRef.current = [];
      fractionalCharsRef.current = 0;
      lastFrameTimeRef.current = 0;
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // When streaming ends, save learned rate for next response and reset state
  useEffect(() => {
    if (!isStreaming) {
      // Save the learned rate if we collected enough data
      if (deltaTimesRef.current.length >= 3) {
        learnedCharsPerMs = charsPerMsRef.current;
      }
      setDisplayLen(text.length);
      targetLenRef.current = text.length;
      deltaTimesRef.current = [];
      fractionalCharsRef.current = 0;
    }
  }, [isStreaming, text.length]);

  // rAF loop to animate displayLen towards target at calculated rate
  useEffect(() => {
    if (!isStreaming) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const tick = (frameTime: number) => {
      const deltaTime = lastFrameTimeRef.current ? frameTime - lastFrameTimeRef.current : 16;
      lastFrameTimeRef.current = frameTime;

      setDisplayLen((prev) => {
        const target = targetLenRef.current;
        if (prev >= target) {
          fractionalCharsRef.current = 0;
          return prev;
        }

        // Calculate chars to reveal based on time elapsed and current rate
        const charsToReveal = deltaTime * charsPerMsRef.current + fractionalCharsRef.current;
        const wholeChars = Math.floor(charsToReveal);
        fractionalCharsRef.current = charsToReveal - wholeChars;

        // Always reveal at least 1 char if we have pending chars, to prevent stalling
        const step = Math.max(wholeChars, prev < target ? 1 : 0);

        return Math.min(prev + step, target);
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    lastFrameTimeRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isStreaming]);

  // Fade cursor after 3s of no movement
  useEffect(() => {
    if (!isStreaming) {
      setCursorStale(false);
      return;
    }
    setCursorStale(false);
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    staleTimerRef.current = setTimeout(() => setCursorStale(true), 3000);
    return () => {
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    };
  }, [displayLen, isStreaming]);

  const visibleText = text.slice(0, displayLen);

  // When streaming with text, show last char with block cursor (reversed colors)
  // When streaming with no text yet, show empty block cursor
  if (isStreaming) {
    if (visibleText.length > 0) {
      const textWithoutLast = visibleText.slice(0, -1);
      const lastChar = visibleText.slice(-1);
      // If last char is whitespace/newline, show a visible space block instead
      const cursorContent = /\s/.test(lastChar) ? " " : lastChar;
      const cursor = <BlockCursor stale={cursorStale}>{cursorContent}</BlockCursor>;
      return <MarkdownContent text={textWithoutLast} cursor={cursor} />;
    }
    // No text yet - show empty cursor
    return <StreamingCursor stale={cursorStale} />;
  }

  return <MarkdownContent text={visibleText} />;
}
