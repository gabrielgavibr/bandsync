import type { BandDto } from "@bandsync/shared";
import { Radio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "../../components/ui";
import { cn } from "../../lib/cn";
import { formatDateTime } from "../../lib/format";
import { useAuth } from "../auth/AuthProvider";
import { useRehearsals } from "../bands/queries";

/**
 * What tapping the rehearsal button will do, said before it is tapped:
 *  resume – a session this person started is running; join – someone else's is running;
 *  start – none is running and this person may conduct; none – nothing to do but wait.
 */
export type LiveEntryKind = "resume" | "join" | "start" | "none";

export function useLiveEntry(band: BandDto) {
  const { user } = useAuth();
  const rehearsals = useRehearsals(band.id);
  const active = rehearsals.data?.active ?? null;
  const kind: LiveEntryKind = active
    ? active.createdBy === user?.id
      ? "resume"
      : "join"
    : band.myPermissions.canControlRehearsal
      ? "start"
      : "none";
  const lastEnded = rehearsals.data?.recent.find((s) => s.status === "ended") ?? null;
  return { kind, active, lastEnded, loading: rehearsals.isPending };
}

/** The way into the live rehearsal: one compact block, the same on every screen that offers it. */
export function LiveEntryCard({ band, className }: { band: BandDto; className?: string }) {
  const { t, i18n } = useTranslation("rehearsal");
  const { kind, active, loading } = useLiveEntry(band);
  const to = active ? `/bands/${band.id}/rehearsal/${active.id}` : `/bands/${band.id}/rehearsal`;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-3 sm:p-4",
        active ? "border-accent-500/60 bg-accent-500/5" : "border-line bg-elev",
        className,
      )}
      data-testid="live-entry"
      data-kind={loading ? "loading" : kind}
    >
      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-accent-500">
        <Radio className="size-5" />
        {active ? (
          <span className="absolute -right-1 -top-1 size-3 animate-pulse rounded-full bg-accent-500" />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-tight">{t(`entry.title.${kind}`)}</p>
        <p className="truncate text-sm text-muted">
          {active
            ? t("entry.since", { when: formatDateTime(active.createdAt, i18n.language) })
            : kind === "none"
              ? t("entry.waitConductor")
              : t("entry.idle")}
        </p>
      </div>
      {kind !== "none" ? (
        <Link to={to} className="shrink-0">
          <Button variant={kind === "start" ? "secondary" : "primary"}>
            {t(`entry.action.${kind}`)}
          </Button>
        </Link>
      ) : null}
    </div>
  );
}
