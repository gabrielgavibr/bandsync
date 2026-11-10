import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { errorText } from "../../lib/errors";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

export function PageHeader({
  title,
  subtitle,
  actions,
  backTo,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backTo?: string;
}) {
  const { t } = useTranslation();
  return (
    // Phones: one compact line (title, actions beside it); the explanatory subtitle is for
    // larger screens, where there is room for it.
    <header className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:mb-6 sm:items-end">
      <div className="min-w-0 flex-1 basis-40">
        {backTo ? (
          <Link
            to={backTo}
            className="-my-1 inline-flex h-9 items-center text-sm text-muted hover:text-fg sm:mb-1 sm:h-auto"
          >
            ← {t("nav.back")}
          </Link>
        ) : null}
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 hidden max-w-2xl text-muted sm:block">{subtitle}</p> : null}
      </div>
      {actions ? (
        // Several actions wrap onto a second line rather than push the page wider than the screen.
        <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-5 py-8 text-center sm:px-6 sm:py-12">
      <p className="text-lg font-medium">{title}</p>
      {body ? <p className="mt-1 max-w-md text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex items-center justify-center gap-3 py-16 text-muted", className)}>
      <Spinner />
      <span>{t("state.loading")}</span>
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-2xl border border-danger-500/40 bg-danger-500/5 p-5 text-center"
      role="alert"
    >
      <p className="font-medium">{t("state.error")}</p>
      <p className="mt-1 text-sm text-muted">{errorText(error)}</p>
      {onRetry ? (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          {t("actions.retry")}
        </Button>
      ) : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "md",
  block = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  ariaLabel: string;
  size?: "md" | "lg";
  /** Fills the width, the options sharing it equally. */
  block?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "max-w-full overflow-x-auto rounded-xl border border-line bg-sunken p-1",
        block ? "flex w-full" : "inline-flex",
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "whitespace-nowrap rounded-lg px-3 font-medium transition-colors",
            block && "min-w-0 flex-1 truncate px-1.5",
            size === "lg" ? "h-12 text-base" : "h-9 text-sm",
            value === o.value ? "bg-elev text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="block font-medium">{label}</span>
        {description ? <span className="block text-sm text-muted">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent-500" : "bg-sunken border border-line",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5.5 left-0" : "left-0.5",
          )}
        />
      </button>
    </label>
  );
}
