"use client";
import { useEffect } from "react";

export function LocatorProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      import("@treelocator/runtime").then((m) => m.default());
    }
  }, []);
  return <>{children}</>;
}
