import type { OccurrenceDto } from "@bandsync/shared";
import { CalendarDays, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge, RowList, rowClass } from "../../components/ui";
import { cn } from "../../lib/cn";
import { useAgenda } from "./queries";
import { isToday, shortWhen } from "./when";

function Row({ o, bandId }: { o: OccurrenceDto; bandId: string }) {
  const { t, i18n } = useTranslation("agenda");
  const live = o.session && o.session.status !== "ended";
  return (
    <li>
      <Link
        to={`/bands/${bandId}/agenda/${o.id}`}
        className={cn(rowClass, "flex items-center gap-3")}
        data-testid="occurrence-row"
      >
        <CalendarDays className="size-5 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium first-letter:uppercase">
            {shortWhen(o, i18n.language)}
          </span>
          <span className="block truncate text-xs text-muted">
            {o.title}
            {o.commentCount > 0 ? (
              <>
                {" · "}
                <MessageSquare className="inline size-3" aria-hidden />{" "}
                {t("board.count", { count: o.commentCount })}
              </>
            ) : null}
          </span>
        </span>
        {o.cancelled ? (
          <Badge tone="danger">{t("cancelled")}</Badge>
        ) : live ? (
          <Badge tone="ok">{t("now")}</Badge>
        ) : isToday(o) ? (
          <Badge tone="accent">{t("today")}</Badge>
        ) : o.myAttendance !== "pending" ? (
          <Badge tone={o.myAttendance === "confirmed" ? "ok" : "neutral"}>
            {t(`attendance.${o.myAttendance}`)}
          </Badge>
        ) : null}
      </Link>
    </li>
  );
}

/** "Próximo ensaio" and the few after it; the agenda's way in from the band's pages. */
export function NextRehearsals({ bandId, limit = 3 }: { bandId: string; limit?: number }) {
  const { t } = useTranslation("agenda");
  const agenda = useAgenda(bandId);
  const upcoming = agenda.data?.upcoming ?? [];
  if (!agenda.data || upcoming.length === 0) return null;
  return (
    <section className="mt-4" data-testid="next-rehearsals">
      <h2 className="mb-2 text-sm font-medium text-muted">{t("upcoming")}</h2>
      <RowList>
        {upcoming.slice(0, limit).map((o) => (
          <Row key={o.id} o={o} bandId={bandId} />
        ))}
      </RowList>
    </section>
  );
}

export function PastRehearsals({ bandId }: { bandId: string }) {
  const { t } = useTranslation("agenda");
  const agenda = useAgenda(bandId);
  const past = agenda.data?.past ?? [];
  if (past.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-medium text-muted">{t("past")}</h2>
      <RowList>
        {past.slice(0, 6).map((o) => (
          <Row key={o.id} o={o} bandId={bandId} />
        ))}
      </RowList>
    </section>
  );
}
