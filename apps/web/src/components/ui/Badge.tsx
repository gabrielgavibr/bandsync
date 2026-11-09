import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";
const tones: Record<Tone, string> = {
  neutral: "bg-sunken text-muted",
  accent: "bg-accent-500/15 text-accent-600 dark:text-accent-300",
  ok: "bg-ok-500/15 text-ok-500",
  warn: "bg-warn-500/15 text-warn-500",
  danger: "bg-danger-500/15 text-danger-500",
};

export function Badge({
  tone = "neutral",
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
