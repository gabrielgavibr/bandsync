import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Select, useToast } from "../../components/ui";
import { http } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { agendaKeys } from "./queries";

const today = () => new Intl.DateTimeFormat("en-CA").format(new Date());

/** A weekly rehearsal: weekday, time on the wall, time zone. The dates follow from the rule. */
export function ScheduleForm({ bandId, onDone }: { bandId: string; onDone?: () => void }) {
  const { t } = useTranslation("agenda");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const weekdays = t("weekdays", { returnObjects: true }) as string[];
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const duration = Number(fd.get("duration") || 0);
    setBusy(true);
    try {
      await http.post(`/api/bands/${bandId}/agenda/schedules`, {
        title: String(fd.get("title") || t("schedule.defaultTitle")),
        weekday: Number(fd.get("weekday")),
        time: String(fd.get("time")),
        timezone: String(fd.get("timezone")),
        startDate: String(fd.get("startDate")),
        durationMinutes: duration > 0 ? duration : null,
        location: String(fd.get("location") || "") || null,
      });
      await qc.invalidateQueries({ queryKey: agendaKeys.agenda(bandId) });
      toast(t("schedule.created"), "success");
      onDone?.();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      data-testid="schedule-form"
    >
      <Input
        name="title"
        label={t("schedule.title")}
        defaultValue={t("schedule.defaultTitle")}
        required
      />
      <Select
        name="weekday"
        label={t("schedule.weekday")}
        defaultValue={String(new Date().getDay())}
      >
        {weekdays.map((w, i) => (
          <option key={w} value={i}>
            {w}
          </option>
        ))}
      </Select>
      <Input name="time" type="time" label={t("schedule.time")} defaultValue="19:00" required />
      <Input
        name="startDate"
        type="date"
        label={t("schedule.startDate")}
        defaultValue={today()}
        required
      />
      <Input name="timezone" label={t("schedule.timezone")} defaultValue={zone} required />
      <Input name="duration" type="number" min={15} max={1440} label={t("schedule.duration")} />
      <Input name="location" label={t("schedule.location")} className="sm:col-span-2" />
      <Button type="submit" loading={busy} className="sm:col-span-2">
        {t("schedule.save")}
      </Button>
    </form>
  );
}
