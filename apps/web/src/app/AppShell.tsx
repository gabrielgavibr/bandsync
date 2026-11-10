import {
  ChevronLeft,
  Guitar,
  Home,
  LayoutGrid,
  ListMusic,
  Music2,
  Radio,
  Settings2,
  Users,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useMatch } from "react-router";
import { useAuth } from "../features/auth/AuthProvider";
import { useBand } from "../features/bands/queries";
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

/** Last band opened on this device: the home page offers it first. */
export const LAST_BAND_KEY = "bandsync.lastBand";

export function AppShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const online = useOnline();
  // Inside a band the bottom bar is the band's own (one bar, never two): the way back to the
  // rest of the app is the arrow in the header.
  const match = useMatch("/bands/:bandId/*");
  const bandId = match?.params.bandId && match.params.bandId !== "new" ? match.params.bandId : null;
  const band = useBand(bandId ?? "", { enabled: !!bandId });
  const global = [
    { to: "/", label: t("nav.home"), icon: Home, end: true },
    { to: "/bands", label: t("nav.bands"), icon: Users, end: true },
    { to: "/tools", label: t("nav.tools"), icon: Wrench, end: false },
    { to: "/profile", label: t("nav.profile"), icon: Settings2, end: false },
  ];
  const inBand = bandId
    ? [
        { to: `/bands/${bandId}`, label: t("nav.band"), icon: LayoutGrid, end: true },
        {
          to: `/bands/${bandId}/rehearsal`,
          label: t("nav.rehearsalShort"),
          icon: Radio,
          end: false,
        },
        { to: `/bands/${bandId}/songs`, label: t("nav.songs"), icon: Music2, end: false },
        {
          to: `/bands/${bandId}/repertoires`,
          label: t("nav.repertoires"),
          icon: ListMusic,
          end: false,
        },
        { to: `/bands/${bandId}/members`, label: t("nav.members"), icon: Users, end: false },
      ]
    : null;
  const bottom = inBand ?? global;
  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-elev focus:px-3 focus:py-2"
      >
        {t("nav.skipToContent")}
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur safe-top">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-3 px-3 sm:h-14 sm:gap-4 sm:px-4">
          {inBand ? (
            // Phone, inside a band: back to the app, and which band this is.
            <div
              className="flex min-w-0 flex-1 items-center gap-1 sm:hidden"
              data-testid="band-header"
            >
              <Link
                to="/"
                aria-label={t("nav.backToHome")}
                className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:text-fg"
              >
                <ChevronLeft className="size-6" />
              </Link>
              <span className="truncate text-base font-semibold">{band.data?.name ?? ""}</span>
            </div>
          ) : null}
          <Link to="/" aria-label="BandSync" className={cn(inBand && "hidden sm:block")}>
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label={t("nav.menu")}>
            {global.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
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
          <Link to="/profile" aria-label={t("nav.profile")} className="shrink-0 sm:hidden">
            <Avatar name={user?.displayName ?? "?"} url={user?.avatarUrl} />
          </Link>
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
      <main
        id="content"
        className="mx-auto w-full max-w-6xl flex-1 px-3 pb-24 pt-3 sm:px-4 sm:pb-10 sm:pt-6"
      >
        <Outlet />
        <p className="mt-8 text-center text-[11px] text-muted/80 sm:mt-10" data-testid="credit">
          {t("credit")}
        </p>
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 backdrop-blur safe-bottom sm:hidden"
        aria-label={inBand ? (band.data?.name ?? t("nav.menu")) : t("nav.menu")}
        data-testid="bottom-nav"
        data-context={inBand ? "band" : "app"}
      >
        {bottom.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                "flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 pt-1.5 text-[11px] leading-tight",
                isActive ? "font-medium text-accent-500" : "text-muted",
              )
            }
          >
            <it.icon className="size-5 shrink-0" />
            <span className="max-w-full truncate">{it.label}</span>
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
