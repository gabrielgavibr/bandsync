import { cn } from "../../lib/cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-block animate-spin rounded-full border-2 border-current border-t-transparent",
        className ?? "size-5",
      )}
    />
  );
}
