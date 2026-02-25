"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  siteKey: string;
  onVerified: () => void;
}

export function TurnstileGate({ siteKey, onVerified }: Props) {
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const verifying = useRef(false);
  const widgetId = useRef<string | null>(null);
  // Stable ref so the effect never re-runs due to parent re-renders
  const onVerifiedRef = useRef(onVerified);
  useEffect(() => { onVerifiedRef.current = onVerified; }, [onVerified]);

  useEffect(() => {
    const verify = async (cfToken: string) => {
      if (verifying.current) return;
      verifying.current = true;
      setError(false);
      try {
        const res = await fetch("/api/verify-turnstile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: cfToken }),
        });
        if (!res.ok) throw new Error("Failed");
        onVerifiedRef.current();
      } catch {
        setError(true);
        verifying.current = false;
        const w = window as any;
        if (widgetId.current !== null) w.turnstile?.reset(widgetId.current);
      }
    };

    const render = () => {
      if (!containerRef.current) return;
      widgetId.current = (window as any).turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: "auto",
        callback: verify,
        "error-callback": () => setError(true),
      });
    };

    const w = window as any;
    let script: HTMLScriptElement | null = null;

    if (w.turnstile) {
      render();
    } else {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = render;
      document.head.appendChild(script);
    }

    return () => {
      if (widgetId.current !== null) w.turnstile?.remove(widgetId.current);
      widgetId.current = null;
      if (script && document.head.contains(script)) document.head.removeChild(script);
    };
  }, [siteKey]); // onVerified intentionally excluded — kept stable via ref

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100dvh",
        gap: "20px",
        background: "var(--background)",
        color: "var(--muted-foreground)",
        fontFamily: "inherit",
        fontSize: "0.9rem",
      }}
    >
      <span>Just a moment…</span>
      <div ref={containerRef} />
      {error && (
        <span style={{ color: "var(--destructive)", fontSize: "0.8rem" }}>
          Verification failed. Please try again.
        </span>
      )}
    </div>
  );
}
