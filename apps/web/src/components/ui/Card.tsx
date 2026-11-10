import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    // min-w-0: inside a grid or a flex row a card shrinks to the space it is given; its content
    // (a row of options, a long line) must never push the page wider than the screen.
    <div
      className={cn("min-w-0 rounded-2xl border border-line bg-elev p-3 sm:p-5", className)}
      {...rest}
    />
  );
}
