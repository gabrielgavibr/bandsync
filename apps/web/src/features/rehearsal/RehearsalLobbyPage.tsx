import { useQueryClient } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import {
  Badge,
  Button,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  RowList,
  Select,
  useToast,
} from "../../components/ui";
import { http } from "../../lib/api";
import { cn } from "../../lib/cn";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { NextRehearsals, PastRehearsals } from "../agenda/NextRehearsal";
import { useAgenda } from "../agenda/queries";
import { ScheduleForm } from "../agenda/ScheduleForm";
import { useAuth } from "../auth/AuthProvider";
import { useCurrentBand } from "../bands/BandLayout";
import { bandKeys, useRehearsals } from "../bands/queries";
import { useRepertoires } from "../repertoire/queries";

export function RehearsalLobbyPage() {
  const { t, i18n } = useTranslation(["rehearsal", "common", "agenda"]);
  const band = useCurrentBand();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const rehearsals = useRehearsals(band.id);
  const repertoires = useRepertoires(band.id);
  const [repertoireId, setRepertoireId] = useState(params.get("repertoire") ?? "");
  const [busy, setBusy] = useState(false);
  const canControl = band.myPermissions.canControlRehearsal;
  const { user } = useAuth();
  const agenda = useAgenda(band.id);
  const [showSchedule, setShowSchedule] = useState(false);
  const canManage = band.myPermissions.canManageEvents;

  const start = async () => {
    setBusy(true);
    try {
      const res = await http.post<{ session: { id: string } }>(`/api/bands/${band.id}/rehearsals`, {
        repertoireId: repertoireId || null,
      });
      await qc.invalidateQueries({ queryKey: bandKeys.rehearsals(band.id) });
      navigate(`/bands/${band.id}/rehearsal/${res.session.id}`);
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  if (rehearsals.isPending) return <LoadingBlock />;
  if (rehearsals.isError)
    return <ErrorBlock error={rehearsals.error} onRetry={() => rehearsals.refetch()} />;
  const active = rehearsals.data.active;

  const mine = !!active && active.createdBy === user?.id;
  const lastEnded = rehearsals.data.recent.find((s) => s.status === "ended") ?? null;

  return (
    <>
      <PageHeader title={t("rehearsal:lobby.title")} subtitle={t("rehearsal:lobby.subtitle")} />
      <div
        className={cn(
          "rounded-2xl border p-3 sm:p-5",
          active ? "border-accent-500/60 bg-accent-500/5" : "border-line bg-elev",
        )}
        data-testid="lobby"
        data-state={active ? (mine ? "resume" : "join") : canControl ? "start" : "none"}
      >
        {active ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-accent-500">
                <Radio className="size-5" />
                <span className="absolute -right-1 -top-1 size-3 animate-pulse rounded-full bg-accent-500" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold leading-tight">
                  {mine ? t("rehearsal:entry.title.resume") : t("rehearsal:entry.title.join")}
                </p>
                <p className="truncate text-sm text-muted">
                  {t("rehearsal:entry.since", {
                    when: formatDateTime(active.createdAt, i18n.language),
                  })}
                </p>
              </div>
            </div>
            <p className="text-sm text-muted">
              {mine ? t("rehearsal:entry.explain.resume") : t("rehearsal:entry.explain.join")}
            </p>
            <Button
              size="lg"
              block
              icon={<Radio className="size-5" />}
              onClick={() => navigate(`/bands/${band.id}/rehearsal/${active.id}`)}
            >
              {mine ? t("rehearsal:entry.action.resume") : t("rehearsal:entry.action.join")}
            </Button>
          </div>
        ) : canControl ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-semibold leading-tight">{t("rehearsal:lobby.none")}</p>
              <p className="text-sm text-muted">{t("rehearsal:entry.explain.start")}</p>
            </div>
            <Select
              label={t("rehearsal:lobby.repertoire")}
              value={repertoireId}
              onChange={(e) => setRepertoireId(e.target.value)}
            >
              <option value="">{t("rehearsal:lobby.noRepertoire")}</option>
              {(repertoires.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (
                  {t("repertoire:repertoires.items", { ns: "repertoire", count: r.itemCount })})
                </option>
              ))}
            </Select>
            <Button
              size="lg"
              block
              onClick={start}
              loading={busy}
              icon={<Radio className="size-5" />}
            >
              {t("rehearsal:lobby.start")}
            </Button>
          </div>
        ) : (
          <div>
            <p className="font-semibold leading-tight">{t("rehearsal:lobby.none")}</p>
            <p className="mt-1 text-sm text-muted">{t("rehearsal:lobby.needsPermission")}</p>
          </div>
        )}
      </div>
      <NextRehearsals bandId={band.id} limit={4} />
      {canManage && agenda.data && agenda.data.schedules.length === 0 ? (
        <section className="mt-4">
          {showSchedule ? (
            <div className="rounded-2xl border border-line bg-elev p-3 sm:p-5">
              <h2 className="mb-3 font-semibold">{t("agenda:schedule.create")}</h2>
              <ScheduleForm bandId={band.id} onDone={() => setShowSchedule(false)} />
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => setShowSchedule(true)}
              data-testid="schedule-create"
            >
              {t("agenda:schedule.create")}
            </Button>
          )}
        </section>
      ) : null}
      {!active && lastEnded ? (
        <p className="mt-2 text-sm text-muted" data-testid="last-ended">
          {t("rehearsal:entry.lastEnded", {
            when: formatDateTime(lastEnded.endedAt ?? lastEnded.createdAt, i18n.language),
          })}
        </p>
      ) : null}
      <PastRehearsals bandId={band.id} />
      {rehearsals.data.recent.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-muted">{t("rehearsal:lobby.recent")}</h2>
          <RowList>
            {rehearsals.data.recent.slice(0, 5).map((s) => (
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
    </>
  );
}
