import type { AttendanceStatus } from "@bandsync/shared";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MapPin, Radio } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import {
  Badge,
  Button,
  Card,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  useToast,
} from "../../components/ui";
import { http } from "../../lib/api";
import { cn } from "../../lib/cn";
import { errorText } from "../../lib/errors";
import { useCurrentBand } from "../bands/BandLayout";
import { bandKeys } from "../bands/queries";
import { Board } from "./Board";
import { agendaKeys, useOccurrence, useSetAttendance } from "./queries";
import { isToday, occurrenceWhen, zoneLabel } from "./when";

const STATUSES: AttendanceStatus[] = ["confirmed", "declined", "pending"];

/** One rehearsal: when and where, who is coming, the way into the live room, and its board. */
export function OccurrencePage() {
  const { eventId = "" } = useParams();
  const band = useCurrentBand();
  const { t, i18n } = useTranslation(["agenda", "common"]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useOccurrence(band.id, eventId);
  const setAttendance = useSetAttendance(band.id, eventId);
  const [opening, setOpening] = useState(false);

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const { occurrence: o, attendance } = q.data;
  const session = o.session;
  const live = session && session.status !== "ended";
  const canControl = band.myPermissions.canControlRehearsal;

  const openLive = async () => {
    if (live) {
      navigate(`/bands/${band.id}/rehearsal/${session.id}`);
      return;
    }
    setOpening(true);
    try {
      const res = await http.post<{ session: { id: string } }>(
        `/api/bands/${band.id}/agenda/occurrences/${o.id}/session`,
      );
      await qc.invalidateQueries({ queryKey: bandKeys.rehearsals(band.id) });
      await qc.invalidateQueries({ queryKey: agendaKeys.occurrence(band.id, o.id) });
      navigate(`/bands/${band.id}/rehearsal/${res.session.id}`);
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
      <PageHeader title={o.title} backTo={`/bands/${band.id}/rehearsal`} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Card data-testid="occurrence" data-live={live ? "true" : session ? "ended" : "none"}>
            <div className="flex flex-wrap items-center gap-2">
              {isToday(o) ? <Badge tone="accent">{t("agenda:today")}</Badge> : null}
              {o.cancelled ? <Badge tone="danger">{t("agenda:cancelled")}</Badge> : null}
              {o.detached ? <Badge>{t("agenda:changedAlone")}</Badge> : null}
              {session?.status === "ended" ? <Badge>{t("agenda:liveEnded")}</Badge> : null}
              {live ? <Badge tone="ok">{t("agenda:liveOpen")}</Badge> : null}
            </div>
            <p className="mt-2 flex items-start gap-2 font-medium" data-testid="occurrence-when">
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <span className="first-letter:uppercase">{occurrenceWhen(o, i18n.language)}</span>
            </p>
            <p className="ml-6 text-xs text-muted">
              {t("agenda:timezoneNote", { zone: zoneLabel(o.timezone) })}
            </p>
            {o.location ? (
              <p className="mt-1 flex items-start gap-2 text-sm">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                {o.location}
              </p>
            ) : null}
            {o.notes ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{o.notes}</p>
            ) : null}
            {!o.cancelled ? (
              <div className="mt-3 flex flex-col gap-2">
                {live || canControl ? (
                  <Button
                    size="lg"
                    block
                    icon={<Radio className="size-5" />}
                    onClick={openLive}
                    loading={opening}
                    data-testid="occurrence-live"
                  >
                    {live ? t("agenda:enterLive") : t("agenda:startLive")}
                  </Button>
                ) : (
                  <p className="text-sm text-muted">{t("agenda:needsControl")}</p>
                )}
                {!live && canControl ? (
                  <p className="text-xs text-muted">{t("agenda:liveExplain")}</p>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className="font-semibold">{t("agenda:attendance.title")}</h2>
            <p className="mt-1 text-sm text-muted">{t("agenda:attendance.mine")}</p>
            <div
              className="mt-2 grid grid-cols-3 gap-2"
              role="radiogroup"
              aria-label={t("agenda:attendance.confirm")}
            >
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={o.myAttendance === s}
                  disabled={setAttendance.isPending}
                  onClick={() =>
                    setAttendance.mutate(s, { onError: (err) => toast(errorText(err), "error") })
                  }
                  className={cn(
                    "min-h-11 rounded-xl border px-2 text-sm font-medium",
                    o.myAttendance === s
                      ? s === "confirmed"
                        ? "border-ok-500 bg-ok-500/15 text-ok-500"
                        : s === "declined"
                          ? "border-danger-500 bg-danger-500/10 text-danger-500"
                          : "border-accent-500 bg-accent-500/10"
                      : "border-line bg-sunken text-muted",
                  )}
                >
                  {t(`agenda:attendance.${s}`)}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted" data-testid="attendance-summary">
              {t("agenda:attendance.summary", o.attendance)}
            </p>
            <ul className="mt-2 divide-y divide-line text-sm">
              {attendance.map((a) => (
                <li key={a.userId} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate">
                    {a.displayName}
                    {a.instrument ? (
                      <span className="text-muted">
                        {" "}
                        · {t(`common:instrument.${a.instrument}`)}
                      </span>
                    ) : null}
                  </span>
                  <Badge
                    tone={
                      a.status === "confirmed"
                        ? "ok"
                        : a.status === "declined"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {t(`agenda:attendance.${a.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card className="flex min-w-0 flex-col">
          <h2 className="mb-2 font-semibold">{t("agenda:board.title")}</h2>
          {session?.status === "ended" ? (
            <p className="mb-2 text-xs text-muted">{t("agenda:board.afterEnd")}</p>
          ) : null}
          <Board bandId={band.id} eventId={o.id} />
        </Card>
      </div>
    </>
  );
}
