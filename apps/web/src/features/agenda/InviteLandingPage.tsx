import type { PersonalInvitePreviewDto, UserDto, UserPreferencesDto } from "@bandsync/shared";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { Wordmark } from "../../app/Brand";
import { Button, Input, LoadingBlock } from "../../components/ui";
import { ApiError, http } from "../../lib/api";
import { errorText } from "../../lib/errors";
import i18n from "../../lib/i18n";
import { useAuth } from "../auth/AuthProvider";
import { bandKeys } from "../bands/queries";

/**
 * Where a personal invitation link lands. Public: the person may not have an account yet.
 * They create their own (their e-mail, their password) or sign in with the one they have; the
 * server decides the band, role and instrument from the invitation, never from this page.
 */
export function InviteLandingPage() {
  const { token = "" } = useParams();
  const { t } = useTranslation(["agenda", "auth", "common"]);
  const { status, user, applySession, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [invite, setInvite] = useState<PersonalInvitePreviewDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"register" | "login">("register");

  useEffect(() => {
    http
      .get<{ invite: PersonalInvitePreviewDto }>(
        `/api/personal-invites/${encodeURIComponent(token)}`,
      )
      .then((r) => setInvite(r.invite))
      .catch((err) =>
        setLoadError(
          err instanceof ApiError && err.code === "invite_invalid"
            ? t("agenda:landing.invalid")
            : errorText(err),
        ),
      );
  }, [token, t]);

  const done = async (band: { id: string; name: string }) => {
    await qc.invalidateQueries({ queryKey: bandKeys.all });
    navigate(`/bands/${band.id}`, { replace: true });
  };

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.code === "already_member" && invite) {
      navigate(`/bands/${invite.band.id}`, { replace: true });
      return;
    }
    setError(errorText(err));
  };

  const register = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await http.post<{
        user: UserDto;
        preferences: UserPreferencesDto;
        band: { id: string; name: string };
      }>(`/api/personal-invites/${encodeURIComponent(token)}/register`, {
        email: String(fd.get("email")),
        password: String(fd.get("password")),
        displayName: String(fd.get("displayName") || "") || undefined,
        locale: i18n.language,
      });
      applySession(res.user, res.preferences);
      await done(res.band);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const login = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await http.post<{ user: UserDto; preferences: UserPreferencesDto }>(
        "/api/auth/login",
        {
          email: String(fd.get("email")),
          password: String(fd.get("password")),
        },
      );
      applySession(res.user, res.preferences);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await http.post<{ band: { id: string; name: string } }>(
        `/api/personal-invites/${encodeURIComponent(token)}/accept`,
      );
      await done(res.band);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const usable = invite?.status === "active";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Wordmark />
        </div>
        <div
          className="rounded-2xl border border-line bg-elev p-5 shadow-sm"
          data-testid="invite-landing"
          data-status={invite?.status ?? (loadError ? "invalid" : "loading")}
        >
          {!invite && !loadError ? <LoadingBlock /> : null}
          {loadError ? (
            <p role="alert" className="text-danger-500">
              {loadError}
            </p>
          ) : null}
          {invite ? (
            <>
              <p className="text-sm text-muted">{t("agenda:landing.band")}</p>
              <p className="text-2xl font-semibold tracking-tight">{invite.band.name}</p>
              <h1 className="mt-3 text-lg font-semibold">
                {t("agenda:landing.title", { name: invite.inviteeName })}
              </h1>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {invite.instrument ? (
                  <>
                    <dt className="text-muted">{t("agenda:landing.as")}</dt>
                    <dd>{t(`common:instrument.${invite.instrument}`)}</dd>
                  </>
                ) : null}
                {invite.secondaryInstruments.length > 0 ? (
                  <>
                    <dt className="text-muted">{t("agenda:landing.secondary")}</dt>
                    <dd>
                      {invite.secondaryInstruments
                        .map((i) => t(`common:instrument.${i}`))
                        .join(", ")}
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted">{t("agenda:landing.role")}</dt>
                <dd>{t(`common:role.${invite.role}`)}</dd>
              </dl>
              {!usable ? (
                <div className="mt-4 flex flex-col gap-3">
                  <p role="alert" className="text-sm text-danger-500">
                    {t(`agenda:landing.${invite.status}`)}
                  </p>
                  <Link
                    className="text-center text-sm font-medium text-accent-600 hover:underline dark:text-accent-300"
                    to="/login"
                  >
                    {t("agenda:landing.login")}
                  </Link>
                </div>
              ) : status === "loading" ? (
                <LoadingBlock />
              ) : status === "authenticated" && user ? (
                <div className="mt-4 flex flex-col gap-3">
                  <p className="text-sm">
                    {t("agenda:landing.signedInAs", { name: user.displayName })}
                  </p>
                  <p className="text-xs text-muted">{t("agenda:landing.notYou")}</p>
                  {error ? (
                    <p role="alert" className="text-sm text-danger-500">
                      {error}
                    </p>
                  ) : null}
                  <Button size="lg" block onClick={accept} loading={busy}>
                    {t("agenda:landing.acceptAs", { name: user.displayName })}
                  </Button>
                  <Button variant="ghost" block onClick={() => void logout()}>
                    {t("agenda:landing.switch")}
                  </Button>
                </div>
              ) : (
                <div className="mt-4">
                  <p className="text-xs text-muted">{t("agenda:landing.notYou")}</p>
                  {mode === "register" ? (
                    <form
                      onSubmit={register}
                      className="mt-3 flex flex-col gap-3"
                      noValidate
                      data-testid="invite-register"
                    >
                      <Input
                        name="displayName"
                        label={t("auth:fields.displayName")}
                        defaultValue={invite.inviteeName}
                        required
                        maxLength={60}
                      />
                      <Input
                        name="email"
                        type="email"
                        label={t("auth:fields.email")}
                        autoComplete="email"
                        inputMode="email"
                        required
                      />
                      <Input
                        name="password"
                        type="password"
                        label={t("auth:fields.password")}
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                      <p className="text-xs text-muted">{t("agenda:landing.privacy")}</p>
                      {error ? (
                        <p role="alert" className="text-sm text-danger-500">
                          {error}
                        </p>
                      ) : null}
                      <Button type="submit" size="lg" block loading={busy}>
                        {t("agenda:landing.create")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        block
                        onClick={() => {
                          setError(null);
                          setMode("login");
                        }}
                      >
                        {t("agenda:landing.haveAccount")}
                      </Button>
                    </form>
                  ) : (
                    <form
                      onSubmit={login}
                      className="mt-3 flex flex-col gap-3"
                      noValidate
                      data-testid="invite-login"
                    >
                      <Input
                        name="email"
                        type="email"
                        label={t("auth:fields.email")}
                        autoComplete="email"
                        inputMode="email"
                        required
                      />
                      <Input
                        name="password"
                        type="password"
                        label={t("auth:fields.password")}
                        autoComplete="current-password"
                        required
                      />
                      {error ? (
                        <p role="alert" className="text-sm text-danger-500">
                          {error}
                        </p>
                      ) : null}
                      <Button type="submit" size="lg" block loading={busy}>
                        {t("agenda:landing.login")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        block
                        onClick={() => {
                          setError(null);
                          setMode("register");
                        }}
                      >
                        {t("agenda:landing.create")}
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
        <p className="mt-6 text-center text-[11px] text-muted/80" data-testid="credit">
          {t("common:credit")}
        </p>
      </div>
    </main>
  );
}
