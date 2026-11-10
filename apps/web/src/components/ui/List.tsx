import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/**
 * A compact grouped list: one bordered block with divided rows, instead of one tall card per
 * item. Rows are at least 52 px high, so they stay comfortable to tap.
 */
export function RowList({ className, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      className={cn(
        "divide-y divide-line overflow-hidden rounded-2xl border border-line bg-elev",
        className,
      )}
      {...rest}
    />
  );
}

/** Classes of one row of a RowList (apply to the row's link, button or div). */
export const rowClass =
  "flex min-h-13 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-sunken/60 sm:px-4";
