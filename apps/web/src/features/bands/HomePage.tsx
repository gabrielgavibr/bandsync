import type { BandDto } from "@bandsync/shared";
import { ChevronRight, Gauge, ListMusic, Music2, Plus, Shuffle, Ticket, Waves } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Avatar, LAST_BAND_KEY } from "../../app/AppShell";
import {
  Button,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  RowList,
  rowClass,
} from "../../components/ui";
import { useAuth } from "../auth/AuthProvider";
import { LiveEntryCard } from "../rehearsal/LiveEntry";
import { useBands, useRehearsals } from "./queries";

function lastBandId(): string | null {
  try {
    return localStorage.getItem(LAST_BAND_KEY);
  } catch {
    return null;
  }
}

/** One band, one line: who it is, how many play in it, whether it is rehearsing right now. */
export function BandRow({ band }: { band: BandDto }) {
  const { t } = useTranslation(["band", "common"]);
  const live = !!useRehearsals(band.id).data?.active;
  return (
    <li>
      <Link to={`/bands/${band.id}`} className={rowClass} data-testid="band-row">
        <Avatar name={band.name} url={band.imageUrl} className="size-10 rounded-xl" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{band.name}</span>
          <span className="block truncate text-sm text-muted">
            {t("common:count.members", { count: band.memberCount })} ·{" "}
            {t(`common:role.${band.myRole}`)}
          </span>
        </span>
        {live ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-accent-500">
            <span className="size-2 animate-pulse rounded-full bg-accent-500" />
            {t("band:home.live")}
          </span>
        ) : null}
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </Link>
    </li>
  );
}

/**
 * Home: where this person left off, their bands, and the tools. Only what exists is shown
 * (no placeholders for features or data that are not there).
 */
export function HomePage() {
  const { t } = useTranslation(["band", "common", "tools"]);
  const { user } = useAuth();
  const bands = useBands();
  if (bands.isPending) return <LoadingBlock />;
  if (bands.isError) return <ErrorBlock error={bands.error} onRetry={() => bands.refetch()} />;
  const list = bands.data;
  const last = list.find((b) => b.id === lastBandId()) ?? list[0] ?? null;
  const first = (user?.displayName ?? "").split(/\s+/)[0];
  const chip =
    "inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-elev px-3 text-sm font-medium hover:border-accent-500/60";

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">
        {first ? t("band:home.hello", { name: first }) : t("band:home.title")}
      </h1>

      {last ? (
        <section aria-labelledby="home-continue" data-testid="home-continue">
          <h2 id="home-continue" className="mb-2 text-sm font-medium text-muted">
            {t("band:home.continue")}
          </h2>
          <div className="flex flex-col gap-2">
            <Link
              to={`/bands/${last.id}`}
              className="flex items-center gap-3 rounded-2xl border border-line bg-elev p-3 hover:border-accent-500/60 sm:p-4"
            >
              <Avatar name={last.name} url={last.imageUrl} className="size-11 rounded-xl" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-semibold leading-tight">
                  {last.name}
                </span>
                <span className="block truncate text-sm text-muted">
                  {t("common:count.members", { count: last.memberCount })}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden="true" />
            </Link>
            <LiveEntryCard band={last} />
            <div className="flex flex-wrap gap-2">
              <Link to={`/bands/${last.id}/repertoires`} className={chip}>
                <ListMusic className="size-4 text-accent-500" /> {t("common:nav.repertoires")}
              </Link>
              <Link to={`/bands/${last.id}/songs`} className={chip}>
                <Music2 className="size-4 text-accent-500" /> {t("common:nav.songs")}
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="home-bands">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="home-bands" className="text-sm font-medium text-muted">
            {t("band:myBands.title")}
          </h2>
          <Link to="/bands" className="text-sm text-accent-600 dark:text-accent-300">
            {t("band:home.manage")}
          </Link>
        </div>
        {list.length === 0 ? (
          <EmptyState
            title={t("band:myBands.empty")}
            body={t("band:myBands.emptyHint")}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link to="/bands/new">
                  <Button icon={<Plus className="size-4" />}>{t("band:myBands.create")}</Button>
                </Link>
                <Link to="/join">
                  <Button variant="secondary" icon={<Ticket className="size-4" />}>
                    {t("band:myBands.join")}
                  </Button>
                </Link>
              </div>
            }
          />
        ) : (
          <RowList>
            {list.map((b) => (
              <BandRow key={b.id} band={b} />
            ))}
          </RowList>
        )}
      </section>

      <section aria-labelledby="home-tools">
        <h2 id="home-tools" className="mb-2 text-sm font-medium text-muted">
          {t("tools:title")}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/tools?tool=metronome" className={chip}>
            <Gauge className="size-4 text-accent-500" /> {t("tools:metronome.title")}
          </Link>
          <Link to="/tools?tool=tuner" className={chip}>
            <Waves className="size-4 text-accent-500" /> {t("tools:tuner.short")}
          </Link>
          <Link to="/tools?tool=transposer" className={chip}>
            <Shuffle className="size-4 text-accent-500" /> {t("tools:transposer.title")}
          </Link>
        </div>
      </section>
    </div>
  );
}
