import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { Button, Card, Input, PageHeader, useToast } from "../../components/ui";
import { errorCode, http } from "../../lib/api";
import { bandKeys } from "./queries";

interface InvitePreview {
  code: string;
  status: string;
  role: string;
  instrument: string | null;
  band: { id: string; name: string; imageUrl: string | null };
  invitedBy: string;
  expiresAt: string;
}

export function JoinPage() {
  const { code: codeParam } = useParams();
  const { t } = useTranslation(["band", "common"]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [code, setCode] = useState(codeParam ?? "");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = useCallback(
    async (c: string) => {
      setError(null);
      setBusy(true);
      try {
        const res = await http.get<{ invite: InvitePreview }>(
          `/api/invites/${encodeURIComponent(c.trim())}`,
        );
        setPreview(res.invite);
        if (res.invite.status !== "active")
          setError(t(`common:errors.invite_${res.invite.status}`));
      } catch (err) {
        setPreview(null);
        setError(t(`common:errors.${errorCode(err)}`));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (codeParam) void lookup(codeParam);
  }, [codeParam, lookup]);

  const accept = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await http.post<{ band: { id: string; name: string } }>("/api/invites/accept", {
        code: preview.code,
      });
      await qc.invalidateQueries({ queryKey: bandKeys.all });
      toast(t("band:join.accepted", { band: res.band.name }), "success");
      navigate(`/bands/${res.band.id}`);
    } catch (err) {
      setError(t(`common:errors.${errorCode(err)}`));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) void lookup(code);
  };

  return (
    <>
      <PageHeader title={t("band:join.title")} backTo="/bands" />
      <Card className="max-w-xl">
        {!preview ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <p className="text-muted">{t("band:join.enterCode")}</p>
            <Input
              label={t("band:join.codeLabel")}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="font-mono"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
            {error ? (
              <p className="text-sm text-danger-500" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" size="lg" loading={busy} disabled={code.trim().length < 6}>
              {t("band:join.lookup")}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-muted">{t("band:join.invitedBy", { inviter: preview.invitedBy })}</p>
            <p className="text-3xl font-semibold tracking-tight">{preview.band.name}</p>
            <p className="text-muted">
              {t(`common:role.${preview.role}`)}
              {preview.instrument
                ? ` · ${t("band:join.asInstrument", { instrument: t(`common:instrument.${preview.instrument}`) })}`
                : ""}
            </p>
            {error ? (
              <p className="text-sm text-danger-500" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                size="lg"
                onClick={accept}
                loading={busy}
                disabled={preview.status !== "active"}
              >
                {t("band:join.accept")}
              </Button>
              <Button size="lg" variant="ghost" onClick={() => navigate("/bands")}>
                {t("band:join.decline")}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
