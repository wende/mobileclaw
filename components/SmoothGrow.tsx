"use client";

import { useRef, useEffect, useCallback, useState } from "react";

interface SmoothGrowProps {
  active: boolean;
  children: React.ReactNode;
  className?: string;
  duration?: number;
}

/**
 * Wraps children in a container that smoothly animates height changes
 * when `active` is true. Uses ResizeObserver to detect content size changes
 * and applies a CSS transition on height.
 *
 * Always renders the same DOM structure to avoid remounting children
 * when `active` toggles.
 */
export function SmoothGrow({ active, children, className, duration = 120 }: SmoothGrowProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef<number | undefined>(undefined);
  const [, forceRender] = useState(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  const measure = useCallback(() => {
    const inner = innerRef.current;
    if (!inner || !activeRef.current) return;
    const h = inner.scrollHeight;
    if (h !== heightRef.current) {
      heightRef.current = h;
      forceRender((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || !active) {
      heightRef.current = undefined;
      return;
    }

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [active, measure]);

  const h = active ? heightRef.current : undefined;

  return (
    <div
      ref={outerRef}
      style={{
        height: h !== undefined ? h : undefined,
        transition: active ? `height ${duration}ms ease-out` : undefined,
      }}
    >
      <div ref={innerRef} className={className}>
        {children}
      </div>
    </div>
  );
}
