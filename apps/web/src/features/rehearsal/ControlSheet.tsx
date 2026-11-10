import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { cn } from "../../lib/cn";

export type SheetLevel = "mini" | "mid" | "full";
const ORDER: SheetLevel[] = ["mini", "mid", "full"];

/** A block that opens and closes with its height animated (no measuring needed). */
function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
      inert={!open}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * The phone's rehearsal controls: a sheet at the bottom of the screen that keeps the music in
 * view. Minimised it is one row; pulled up it shows the playing controls, then everything.
 * The row at the bottom stays in the page's flow (the material ends above it); what opens,
 * opens upwards over the material. Drag the handle up or down, or tap it.
 */
export function ControlSheet({
  level,
  onLevel,
  handleLabel,
  mini,
  mid,
  full,
}: {
  level: SheetLevel;
  onLevel: (l: SheetLevel) => void;
  /** Accessible name of the handle (says what a tap will do). */
  handleLabel: string;
  mini: ReactNode;
  mid: ReactNode;
  full: ReactNode;
}) {
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  const step = (by: number) => {
    const i = ORDER.indexOf(level);
    onLevel(ORDER[Math.max(0, Math.min(ORDER.length - 1, i + by))]!);
  };
  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = e.clientY;
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (start.current === null) return;
    // The sheet follows the finger a little, enough to feel it give.
    setDrag(Math.max(-28, Math.min(48, (e.clientY - start.current) * 0.5)));
  };
  const onUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (start.current === null) return;
    const dy = e.clientY - start.current;
    start.current = null;
    setDrag(0);
    if (Math.abs(dy) < 10)
      // A tap: one step up, and from the top back to the smallest.
      onLevel(level === "full" ? "mini" : ORDER[ORDER.indexOf(level) + 1]!);
    else if (dy < 0) step(dy < -180 ? 2 : 1);
    else step(dy > 180 ? -2 : -1);
  };

  return (
    <footer
      data-testid="control-sheet"
      data-level={level}
      className={cn(
        "relative z-30 bg-elev safe-bottom",
        drag === 0 && "transition-transform duration-200 motion-reduce:transition-none",
      )}
      style={{ transform: drag ? `translateY(${drag}px)` : undefined }}
    >
      <div className="absolute inset-x-0 bottom-full max-h-[72dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-line bg-elev shadow-[0_-10px_30px_rgba(0,0,0,0.28)]">
        <button
          type="button"
          data-testid="sheet-handle"
          aria-label={handleLabel}
          aria-expanded={level !== "mini"}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => {
            start.current = null;
            setDrag(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") step(1);
            else if (e.key === "ArrowDown") step(-1);
            else if (e.key === "Enter" || e.key === " ")
              onLevel(level === "full" ? "mini" : ORDER[ORDER.indexOf(level) + 1]!);
            else return;
            e.preventDefault();
          }}
          className="sticky top-0 z-10 flex h-6 w-full touch-none items-center justify-center bg-elev"
        >
          <span aria-hidden="true" className="h-1.5 w-11 rounded-full bg-muted/50" />
        </button>
        <Fold open={level === "full"}>
          <div className="px-3 pb-3" data-testid="sheet-full">
            {full}
          </div>
        </Fold>
        <Fold open={level !== "mini"}>
          <div className="px-3 pb-2" data-testid="sheet-mid">
            {mid}
          </div>
        </Fold>
      </div>
      <div className="px-3 pt-0.5" data-testid="sheet-mini">
        {mini}
      </div>
    </footer>
  );
}
