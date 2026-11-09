import { useQueryClient } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import {
  Badge,
  Button,
  Card,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Select,
  useToast,
} from "../../components/ui";
import { http } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { useCurrentBand } from "../bands/BandLayout";
import { bandKeys, useRehearsals } from "../bands/queries";
import { useRepertoires } from "../repertoire/queries";

export function RehearsalLobbyPage() {
  const { t, i18n } = useTranslation(["rehearsal", "common"]);
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

  return (
    <>
      <PageHeader title={t("rehearsal:lobby.title")} subtitle={t("rehearsal:lobby.subtitle")} />
      <Card className={active ? "border-accent-500/60 bg-accent-500/5" : undefined}>
        {active ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="relative flex size-12 items-center justify-center rounded-xl bg-sunken text-accent-500">
                <Radio className="size-6" />
                <span className="absolute -right-1 -top-1 size-3 animate-pulse rounded-full bg-accent-500" />
              </span>
              <div>
                <p className="text-lg font-semibold">{t("rehearsal:lobby.active")}</p>
                <p className="text-sm text-muted">
                  {t(`rehearsal:status.${active.status}`, { defaultValue: active.status })} ·{" "}
                  {formatDateTime(active.createdAt, i18n.language)}
                </p>
              </div>
            </div>
            <Button size="xl" onClick={() => navigate(`/bands/${band.id}/rehearsal/${active.id}`)}>
              {t("rehearsal:lobby.join")}
            </Button>
          </div>
        ) : canControl ? (
          <div className="flex flex-col gap-4">
            <p className="text-lg font-semibold">{t("rehearsal:lobby.none")}</p>
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
            <Button size="xl" onClick={start} loading={busy} icon={<Radio className="size-6" />}>
              {t("rehearsal:lobby.start")}
            </Button>
          </div>
        ) : (
          <div>
            <p className="text-lg font-semibold">{t("rehearsal:lobby.none")}</p>
            <p className="mt-1 text-muted">{t("rehearsal:lobby.needsPermission")}</p>
          </div>
        )}
      </Card>
      {rehearsals.data.recent.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">{t("rehearsal:lobby.recent")}</h2>
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
        </section>
      ) : null}
    </>
  );
}
