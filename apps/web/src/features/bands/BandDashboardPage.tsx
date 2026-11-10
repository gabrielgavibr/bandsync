import { ChevronRight, ListMusic, Music2, Radio, Users, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Avatar } from "../../app/AppShell";
import { Badge, Button, RowList, rowClass } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { NextRehearsals } from "../agenda/NextRehearsal";
import { LiveEntryCard, useLiveEntry } from "../rehearsal/LiveEntry";
import { useRepertoires, useSongs } from "../repertoire/queries";
import { useCurrentBand } from "./BandLayout";
import { useRehearsals } from "./queries";

function NavRow({
  to,
  icon,
  label,
  detail,
}: {
  to: string;
  icon: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <li>
      <Link to={to} className={rowClass}>
        <span className="text-accent-500">{icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        {detail ? <span className="shrink-0 text-sm text-muted">{detail}</span> : null}
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </Link>
    </li>
  );
}

/**
 * The band at a glance, in the order a musician needs it: who the band is, the rehearsal, the
 * list being rehearsed, then the rest. Nothing is shown for features that have no data yet.
 */
export function BandDashboardPage() {
  const { t, i18n } = useTranslation(["band", "common", "rehearsal", "repertoire"]);
  const band = useCurrentBand();
  const rehearsals = useRehearsals(band.id);
  const repertoires = useRepertoires(band.id);
  const songs = useSongs(band.id);
  const { active, kind } = useLiveEntry(band);
  // The list in use: the one of the running session, otherwise the first the band keeps.
  const current =
    repertoires.data?.find((r) => r.id === active?.repertoireId) ?? repertoires.data?.[0] ?? null;
  const recent = (rehearsals.data?.recent ?? []).slice(0, 3);
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3" data-testid="band-identity">
        <Avatar name={band.name} url={band.imageUrl} className="size-12 rounded-xl text-sm" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-3xl">{band.name}</h1>
          <p className="truncate text-sm text-muted">
            {[band.genre, t("common:count.members", { count: band.memberCount })]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Badge tone={band.myRole === "admin" ? "accent" : "neutral"}>
          {t(`common:role.${band.myRole}`)}
        </Badge>
      </header>

      <LiveEntryCard band={band} />
      <NextRehearsals bandId={band.id} limit={1} />

      {current ? (
        <section aria-labelledby="dash-rep" data-testid="current-repertoire">
          <h2 id="dash-rep" className="mb-2 text-sm font-medium text-muted">
            {active?.repertoireId === current.id
              ? t("band:dashboard.repertoireInSession")
              : t("band:dashboard.repertoire")}
          </h2>
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-elev p-2 pl-3 sm:pl-4">
            <Link
              to={`/bands/${band.id}/repertoires/${current.id}`}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-3"
            >
              <ListMusic className="size-5 shrink-0 text-accent-500" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{current.name}</span>
                <span className="block text-sm text-muted">
                  {t("repertoire:repertoires.items", { count: current.itemCount })}
                </span>
              </span>
            </Link>
            {kind === "start" && current.itemCount > 0 ? (
              <Link
                to={`/bands/${band.id}/rehearsal?repertoire=${current.id}`}
                className="shrink-0"
              >
                <Button variant="secondary" size="sm" icon={<Radio className="size-4" />}>
                  {t("band:dashboard.rehearseList")}
                </Button>
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <RowList aria-label={band.name}>
        <NavRow
          to={`/bands/${band.id}/songs`}
          icon={<Music2 className="size-5" />}
          label={t("band:dashboard.songs")}
          detail={songs.data ? songs.data.length : undefined}
        />
        <NavRow
          to={`/bands/${band.id}/repertoires`}
          icon={<ListMusic className="size-5" />}
          label={t("band:dashboard.repertoires")}
          detail={repertoires.data ? repertoires.data.length : undefined}
        />
        <NavRow
          to={`/bands/${band.id}/members`}
          icon={<Users className="size-5" />}
          label={t("band:dashboard.members")}
          detail={band.memberCount}
        />
        <NavRow
          to={`/bands/${band.id}/tools`}
          icon={<Wrench className="size-5" />}
          label={t("band:dashboard.tools")}
        />
      </RowList>

      {recent.length > 0 ? (
        <section aria-labelledby="dash-recent">
          <h2 id="dash-recent" className="mb-2 text-sm font-medium text-muted">
            {t("band:dashboard.recentSessions")}
          </h2>
          <RowList>
            {recent.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm sm:px-4"
              >
                <span>{formatDateTime(s.createdAt, i18n.language)}</span>
                <Badge tone={s.status === "ended" ? "neutral" : "accent"}>
                  {t(`rehearsal:status.${s.status}`, { defaultValue: s.status })}
                </Badge>
              </li>
            ))}
          </RowList>
        </section>
      ) : null}
    </div>
  );
}
