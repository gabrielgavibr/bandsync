import type { BandDto } from "@bandsync/shared";
import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useParams } from "react-router";
import { ErrorBlock, LoadingBlock } from "../../components/ui";
import { cn } from "../../lib/cn";
import { useBand } from "./queries";

const BandCtx = createContext<BandDto | null>(null);

export function useCurrentBand(): BandDto {
  const b = useContext(BandCtx);
  if (!b) throw new Error("useCurrentBand outside BandLayout");
  return b;
}

export function BandLayout() {
  const { bandId = "" } = useParams();
  const { t } = useTranslation();
  const band = useBand(bandId);
  if (band.isPending) return <LoadingBlock />;
  if (band.isError) return <ErrorBlock error={band.error} onRetry={() => band.refetch()} />;
  const tabs = [
    { to: `/bands/${bandId}`, label: t("nav.dashboard"), end: true },
    { to: `/bands/${bandId}/rehearsal`, label: t("nav.rehearsal") },
    { to: `/bands/${bandId}/songs`, label: t("nav.songs") },
    { to: `/bands/${bandId}/repertoires`, label: t("nav.repertoires") },
    { to: `/bands/${bandId}/members`, label: t("nav.members") },
  ];
  return (
    <BandCtx.Provider value={band.data}>
      <div className="mb-5 -mx-4 overflow-x-auto px-4">
        <nav
          className="flex w-max gap-1 rounded-xl border border-line bg-sunken p-1"
          aria-label={band.data.name}
        >
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium",
                  isActive ? "bg-elev text-fg shadow-sm" : "text-muted hover:text-fg",
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </BandCtx.Provider>
  );
}
