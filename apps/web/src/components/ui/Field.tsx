import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";
import { cn } from "../../lib/cn";

interface BaseProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
}

const control =
  "w-full rounded-xl border border-line bg-elev px-3.5 text-fg placeholder:text-muted/70 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 disabled:opacity-60";

function Wrapper({
  id,
  label,
  hint,
  error,
  className,
  children,
}: BaseProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-danger-500" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({
  label,
  hint,
  error,
  className,
  ...rest
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} className={className}>
      <input id={id} className={cn(control, "h-12")} aria-invalid={!!error} {...rest} />
    </Wrapper>
  );
}

export function Textarea({
  label,
  hint,
  error,
  className,
  ...rest
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} className={className}>
      <textarea
        id={id}
        className={cn(control, "min-h-28 py-3 leading-relaxed")}
        aria-invalid={!!error}
        {...rest}
      />
    </Wrapper>
  );
}

export function Select({
  label,
  hint,
  error,
  className,
  children,
  ...rest
}: BaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} className={className}>
      <select id={id} className={cn(control, "h-12")} aria-invalid={!!error} {...rest}>
        {children}
      </select>
    </Wrapper>
  );
}
