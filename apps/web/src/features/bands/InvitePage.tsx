import { INSTRUMENTS, type InviteDto } from "@bandsync/shared";
import { Check, Copy } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
  Segmented,
  Select,
  useToast,
} from "../../components/ui";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { useCurrentBand } from "./BandLayout";
import { useCreateInvite, useInvites, useRevokeInvite } from "./queries";

type Kind = "code" | "link" | "email";

export function InvitePage() {
  const { t, i18n } = useTranslation(["band", "common"]);
  const band = useCurrentBand();
  const create = useCreateInvite(band.id);
  const revoke = useRevokeInvite(band.id);
  const invites = useInvites(band.id, band.myRole === "admin");
  const { toast } = useToast();
  const [kind, setKind] = useState<Kind>("code");
  const [result, setResult] = useState<{
    invite: InviteDto;
    url: string;
    emailSent: boolean;
  } | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const res = await create.mutateAsync({
        kind,
        email: kind === "email" ? String(fd.get("email")) : undefined,
        instrument: String(fd.get("instrument") || "") || undefined,
        role: String(fd.get("role") || "member"),
        expiresInHours: Number(fd.get("expiresInHours") || 72),
        maxUses: Number(fd.get("maxUses") || 1),
        locale: i18n.language,
      });
      setResult(res);
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  if (band.myRole !== "admin") {
    return (
      <PageHeader
        title={t("band:invite.title")}
        subtitle={t("common:errors.forbidden")}
        backTo={`/bands/${band.id}/members`}
      />
    );
  }

  const active = invites.data?.filter((i) => i.status === "active") ?? [];
  const past = invites.data?.filter((i) => i.status !== "active") ?? [];

  return (
    <>
      <PageHeader
        title={t("band:invite.title")}
        subtitle={t("band:invite.subtitle")}
        backTo={`/bands/${band.id}/members`}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Segmented
              ariaLabel={t("band:invite.kind.code")}
              value={kind}
              onChange={(k) => {
                setKind(k);
                setResult(null);
              }}
              options={(["code", "link", "email"] as Kind[]).map((k) => ({
                value: k,
                label: t(`band:invite.kind.${k}`),
              }))}
            />
            <p className="text-sm text-muted">{t(`band:invite.kindHelp.${kind}`)}</p>
            {kind === "email" ? (
              <Input
                name="email"
                type="email"
                label={t("band:invite.email")}
                required
                inputMode="email"
              />
            ) : null}
            <Select name="instrument" label={t("band:invite.instrument")} defaultValue="">
              <option value="">{t("common:instrument.none")}</option>
              {INSTRUMENTS.map((i) => (
                <option key={i} value={i}>
                  {t(`common:instrument.${i}`)}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-3 gap-3">
              <Select name="role" label={t("band:invite.role")} defaultValue="member">
                <option value="member">{t("common:role.member")}</option>
                <option value="admin">{t("common:role.admin")}</option>
              </Select>
              <Select name="expiresInHours" label={t("band:invite.expiresIn")} defaultValue="72">
                <option value="24">{t("band:invite.hours", { count: 24 })}</option>
                <option value="72">{t("band:invite.days", { count: 3 })}</option>
                <option value="168">{t("band:invite.days", { count: 7 })}</option>
                <option value="720">{t("band:invite.days", { count: 30 })}</option>
              </Select>
              <Select name="maxUses" label={t("band:invite.maxUses")} defaultValue="1">
                {[1, 5, 10, 25].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" size="lg" loading={create.isPending}>
              {t("band:invite.create")}
            </Button>
          </form>
          {result ? <InviteResult result={result} /> : null}
        </Card>
        <div className="flex flex-col gap-6">
          <section>
            <h2 className="mb-2 font-semibold">{t("band:invite.active")}</h2>
            <InviteList
              invites={active}
              onRevoke={async (id) => {
                try {
                  await revoke.mutateAsync(id);
                } catch (err) {
                  toast(errorText(err), "error");
                }
              }}
            />
          </section>
          {past.length > 0 ? (
            <section>
              <h2 className="mb-2 font-semibold">{t("band:invite.history")}</h2>
              <InviteList invites={past} />
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function InviteResult({
  result,
}: {
  result: { invite: InviteDto; url: string; emailSent: boolean };
}) {
  const { t } = useTranslation(["band", "common"]);
  const isCode = result.invite.kind === "code";
  return (
    <div className="mt-5 rounded-xl border border-accent-500/40 bg-accent-500/5 p-4">
      <p className="font-semibold">{t("band:invite.created")}</p>
      <p className="mt-1 text-sm text-muted">
        {isCode ? t("band:invite.shareCode") : t("band:invite.shareLink")}
      </p>
      {isCode ? (
        <p className="my-3 select-all text-center font-mono text-4xl font-semibold tracking-[0.3em]">
          {result.invite.code}
        </p>
      ) : (
        <p className="my-3 break-all rounded-lg bg-sunken p-2 font-mono text-sm">{result.url}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <CopyButton text={isCode ? result.invite.code : result.url} />
        {!isCode ? (
          <CopyButton text={result.invite.code} label={t("band:invite.kind.code")} />
        ) : null}
      </div>
      {result.invite.kind === "email" ? (
        <p className="mt-3 text-sm text-muted">
          {result.emailSent ? t("band:invite.emailSent") : t("band:invite.emailNotSent")}
        </p>
      ) : null}
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard may be unavailable; the text is still visible for manual copy
        }
      }}
    >
      {copied ? t("actions.copied") : (label ?? t("actions.copy"))}
    </Button>
  );
}

function InviteList({
  invites,
  onRevoke,
}: {
  invites: InviteDto[];
  onRevoke?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation(["band", "common"]);
  if (invites.length === 0) return <p className="text-sm text-muted">{t("band:invite.none")}</p>;
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line">
      {invites.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
          <span className="font-mono font-semibold">
            {i.kind === "code" ? i.code : t(`band:invite.kind.${i.kind}`)}
          </span>
          {i.email ? <span className="text-muted">{i.email}</span> : null}
          <Badge tone={i.status === "active" ? "ok" : "neutral"}>
            {t(`band:invite.status.${i.status}`)}
          </Badge>
          <span className="text-muted">{t("band:invite.usesLeft", { count: i.usesLeft })}</span>
          <span className="text-muted">
            {t("band:invite.expires", { date: formatDateTime(i.expiresAt, i18n.language) })}
          </span>
          {onRevoke && i.status === "active" ? (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onRevoke(i.id)}>
              {t("band:invite.revoke")}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
