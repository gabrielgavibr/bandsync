import { Guitar, Settings2, Users, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "../features/auth/AuthProvider";
import { cn } from "../lib/cn";
import { Wordmark } from "./Brand";

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function AppShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const online = useOnline();
  const items = [
    { to: "/bands", label: t("nav.bands"), icon: Users },
    { to: "/tools", label: t("nav.tools"), icon: Wrench },
    { to: "/profile", label: t("nav.profile"), icon: Settings2 },
  ];
  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-elev focus:px-3 focus:py-2"
      >
        {t("nav.skipToContent")}
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur safe-top">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/bands" aria-label="BandSync">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label={t("nav.menu")}>
            {items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-lg px-3 py-2 text-sm font-medium",
                    isActive ? "bg-elev text-fg" : "text-muted hover:text-fg",
                  )
                }
              >
                {it.label}
              </NavLink>
            ))}
            <Link
              to="/profile"
              className="ml-2 flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-sm"
            >
              <Avatar name={user?.displayName ?? "?"} url={user?.avatarUrl} />
              <span className="max-w-32 truncate">{user?.displayName}</span>
            </Link>
          </nav>
        </div>
        {!online ? (
          <div
            className="bg-warn-500/15 px-4 py-1.5 text-center text-sm text-warn-500"
            role="status"
          >
            {t("state.offline")}
          </div>
        ) : null}
      </header>
      <main id="content" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 sm:pb-10">
        <Outlet />
        <p className="mt-10 text-center text-[11px] text-muted/80" data-testid="credit">
          {t("credit")}
        </p>
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 backdrop-blur safe-bottom sm:hidden"
        aria-label={t("nav.menu")}
      >
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs",
                isActive ? "text-accent-500" : "text-muted",
              )
            }
          >
            <it.icon className="size-5" />
            {it.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function Avatar({
  name,
  url,
  className,
}: {
  name: string;
  url?: string | null;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return url ? (
    <img src={url} alt="" className={cn("size-8 rounded-full object-cover", className)} />
  ) : (
    <span
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full bg-accent-500/20 text-xs font-semibold text-accent-600 dark:text-accent-300",
        className,
      )}
      aria-hidden="true"
    >
      {initials || <Guitar className="size-4" />}
    </span>
  );
}
