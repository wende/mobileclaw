"use client";

import { useEffect, useState } from "react";

interface UseElapsedSecondsOptions {
  startTime?: number;
  active?: boolean;
}

/**
 * Tracks elapsed whole seconds from a start timestamp while active.
 * Resets to 0 when inactive or no start time is provided.
 */
export function useElapsedSeconds({ startTime, active = true }: UseElapsedSecondsOptions): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTime || !active) {
      setElapsed(0);
      return;
    }

    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    };

    updateElapsed();
    const timerId = window.setInterval(updateElapsed, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [active, startTime]);

  return elapsed;
}
