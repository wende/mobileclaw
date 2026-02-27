interface ZenToggleProps {
  expanded: boolean;
  onClick?: () => void;
  className?: string;
  testId?: string;
}

export function ZenToggle({
  expanded,
  onClick,
  className,
  testId = "zen-toggle",
}: ZenToggleProps) {
  const label = expanded ? "Collapse assistant steps" : "Expand assistant steps";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground ${className ?? ""}`}
      aria-label={label}
      data-testid={testId}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-transform duration-200"
        style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}
