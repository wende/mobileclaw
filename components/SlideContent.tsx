/**
 * Animated slide wrapper using CSS grid-template-rows trick.
 * Smoothly transitions between 0fr (collapsed) and 1fr (expanded).
 */
export function SlideContent({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden min-h-0">
        {children}
      </div>
    </div>
  );
}
