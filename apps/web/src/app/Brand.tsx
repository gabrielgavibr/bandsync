import { cn } from "../lib/cn";

/** BandSync wordmark: four bars of different heights falling into line. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-8", className)}>
      <rect width="64" height="64" rx="14" className="fill-[#0b0f14] dark:fill-[#121820]" />
      <g fill="none" stroke="#2dd4bf" strokeWidth="5" strokeLinecap="round">
        <line x1="14" y1="26" x2="14" y2="38" />
        <line x1="26" y1="18" x2="26" y2="46" />
        <line x1="38" y1="22" x2="38" y2="42" />
        <line x1="50" y1="28" x2="50" y2="36" />
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}
    >
      <BrandMark />
      <span className="text-xl">
        Band<span className="text-accent-500">Sync</span>
      </span>
    </span>
  );
}
