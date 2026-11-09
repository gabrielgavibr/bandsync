import { ListMusic, Music2, Radio, Users, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge, Button, Card, PageHeader } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useCurrentBand } from "./BandLayout";
import { useRehearsals } from "./queries";

function Tile({ to, icon, label }: { to: string; icon: ReactNode; label: ReactNode }) {
  return (
    <Link to={to}>
      <Card className="flex items-center gap-3 transition-colors hover:border-accent-500/60">
        <span className="rounded-xl bg-sunken p-2.5 text-accent-500">{icon}</span>
        <span className="font-medium">{label}</span>
      </Card>
    </Link>
  );
}

export function BandDashboardPage() {
  const { t, i18n } = useTranslation(["band", "common", "rehearsal"]);
  const band = useCurrentBand();
  const rehearsals = useRehearsals(band.id);
  const active = rehearsals.data?.active ?? null;
  return (
    <>
      <PageHeader
        title={band.name}
        subtitle={band.description ?? band.genre ?? undefined}
        actions={
          <Badge tone={band.myRole === "admin" ? "accent" : "neutral"}>
            {t(`common:role.${band.myRole}`)}
          </Badge>
        }
      />
      <Card className={active ? "border-accent-500/60 bg-accent-500/5" : undefined}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex size-11 items-center justify-center rounded-xl bg-sunken text-accent-500">
              <Radio className="size-6" />
              {active ? (
                <span className="absolute -right-1 -top-1 size-3 animate-pulse rounded-full bg-accent-500" />
              ) : null}
            </span>
            <div>
              <p className="font-semibold">
                {active ? t("band:dashboard.liveNow") : t("rehearsal:lobby.none")}
              </p>
              {active ? (
                <p className="text-sm text-muted">
                  {t(`rehearsal:status.${active.status}`, { defaultValue: active.status })}
                </p>
              ) : null}
            </div>
          </div>
          <Link
            to={active ? `/bands/${band.id}/rehearsal/${active.id}` : `/bands/${band.id}/rehearsal`}
          >
            <Button size="lg">
              {active ? t("band:dashboard.joinLive") : t("band:dashboard.startLive")}
            </Button>
          </Link>
        </div>
      </Card>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          to={`/bands/${band.id}/songs`}
          icon={<Music2 className="size-5" />}
          label={t("band:dashboard.songs")}
        />
        <Tile
          to={`/bands/${band.id}/repertoires`}
          icon={<ListMusic className="size-5" />}
          label={t("band:dashboard.repertoires")}
        />
        <Tile
          to={`/bands/${band.id}/members`}
          icon={<Users className="size-5" />}
          label={t("band:dashboard.members")}
        />
        <Tile
          to={`/bands/${band.id}/tools`}
          icon={<Wrench className="size-5" />}
          label={t("band:dashboard.tools")}
        />
      </div>
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">{t("band:dashboard.recentSessions")}</h2>
        {rehearsals.data && rehearsals.data.recent.length > 0 ? (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {rehearsals.data.recent.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>{formatDateTime(s.createdAt, i18n.language)}</span>
                <Badge tone={s.status === "ended" ? "neutral" : "accent"}>
                  {t(`rehearsal:status.${s.status}`, { defaultValue: s.status })}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t("band:dashboard.noSessions")}</p>
        )}
      </section>
    </>
  );
}
