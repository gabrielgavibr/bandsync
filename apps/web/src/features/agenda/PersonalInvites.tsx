import { INSTRUMENTS, type PersonalInviteDto } from "@bandsync/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, RowList, Select, useToast } from "../../components/ui";
import { http } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { agendaKeys, usePersonalInvites } from "./queries";

const tone = (s: PersonalInviteDto["status"]) =>
  s === "used" ? "ok" : s === "active" ? "accent" : "neutral";

/** Admin panel: one private link per musician, shown once when created. */
export function PersonalInvites({ bandId }: { bandId: string }) {
  const { t, i18n } = useTranslation(["agenda", "common"]);
  const qc = useQueryClient();
  const { toast } = useToast();
  const invites = usePersonalInvites(bandId);
  const [created, setCreated] = useState<{ name: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("agenda:invites.copied"), "success");
    } catch {
      /* the link stays selectable on screen */
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    try {
      const res = await http.post<{ invite: PersonalInviteDto; url: string }>(
        `/api/bands/${bandId}/personal-invites`,
        {
          inviteeName: String(fd.get("inviteeName")),
          instrument: String(fd.get("instrument") || "") || null,
          role: String(fd.get("role") || "member"),
        },
      );
      setCreated({ name: res.invite.inviteeName, url: res.url });
      form.reset();
      await qc.invalidateQueries({ queryKey: agendaKeys.personalInvites(bandId) });
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await http.delete(`/api/bands/${bandId}/personal-invites/${id}`);
      toast(t("agenda:invites.revoked"), "success");
      await qc.invalidateQueries({ queryKey: agendaKeys.personalInvites(bandId) });
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  return (
    <Card className="mb-4" data-testid="personal-invites">
      <h2 className="font-semibold">{t("agenda:invites.title")}</h2>
      <p className="mt-1 text-sm text-muted">{t("agenda:invites.explain")}</p>
      <form onSubmit={onSubmit} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input name="inviteeName" label={t("agenda:invites.name")} required maxLength={60} />
        <Select name="instrument" label={t("agenda:invites.instrument")} defaultValue="">
          <option value="">{t("common:instrument.none")}</option>
          {INSTRUMENTS.map((i) => (
            <option key={i} value={i}>
              {t(`common:instrument.${i}`)}
            </option>
          ))}
        </Select>
        <Select name="role" label={t("agenda:invites.role")} defaultValue="member">
          <option value="member">{t("common:role.member")}</option>
          <option value="admin">{t("common:role.admin")}</option>
        </Select>
        <Button type="submit" loading={busy} className="sm:col-span-3">
          {t("agenda:invites.create")}
        </Button>
      </form>
      {created ? (
        <div
          className="mt-3 rounded-xl border border-accent-500/40 bg-accent-500/5 p-3"
          data-testid="personal-invite-created"
        >
          <p className="text-sm">{t("agenda:invites.created")}</p>
          <p className="mt-1 font-medium">{created.name}</p>
          <p
            className="mt-1 select-all break-all font-mono text-xs"
            data-testid="personal-invite-url"
          >
            {created.url}
          </p>
          <Button
            size="sm"
            className="mt-2"
            icon={<Copy className="size-4" />}
            onClick={() => copy(created.url)}
          >
            {t("agenda:invites.copy")}
          </Button>
        </div>
      ) : null}
      {(invites.data?.length ?? 0) > 0 ? (
        <RowList className="mt-3">
          {invites.data!.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{inv.inviteeName}</span>
                <span className="block truncate text-xs text-muted">
                  {inv.instrument ? t(`common:instrument.${inv.instrument}`) : ""}
                  {inv.role === "admin" ? ` · ${t("common:role.admin")}` : ""}
                  {" · "}
                  {inv.status === "used" && inv.acceptedByName
                    ? t("agenda:invites.acceptedBy", { name: inv.acceptedByName })
                    : t("agenda:invites.expires", {
                        when: formatDateTime(inv.expiresAt, i18n.language),
                      })}
                </span>
              </span>
              <Badge tone={tone(inv.status)}>{t(`agenda:invites.status.${inv.status}`)}</Badge>
              {inv.status === "active" ? (
                <Button size="sm" variant="ghost" onClick={() => revoke(inv.id)}>
                  {t("agenda:invites.revoke")}
                </Button>
              ) : null}
            </li>
          ))}
        </RowList>
      ) : null}
    </Card>
  );
}
