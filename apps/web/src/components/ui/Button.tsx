import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "xl";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const variants: Record<Variant, string> = {
  primary: "bg-accent-500 text-[#04221f] hover:bg-accent-400 active:bg-accent-600 font-semibold",
  secondary: "bg-elev border border-line text-fg hover:border-accent-500/60 active:bg-sunken",
  outline: "border border-line text-fg hover:bg-elev",
  ghost: "text-fg hover:bg-elev",
  danger: "bg-danger-600 text-white hover:bg-danger-500",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-11 px-4 text-[15px] gap-2 rounded-xl",
  lg: "h-14 px-6 text-lg gap-2.5 rounded-2xl",
  xl: "h-20 px-8 text-2xl gap-3 rounded-2xl",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  block,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center select-none whitespace-nowrap transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
}
