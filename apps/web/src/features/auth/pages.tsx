import { INSTRUMENTS } from "@bandsync/shared";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Wordmark } from "../../app/Brand";
import { Button, Input, Select } from "../../components/ui";
import { ApiError, http } from "../../lib/api";
import i18n from "../../lib/i18n";
import { useAuth } from "./AuthProvider";

function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Wordmark className="scale-110" />
          <p className="text-sm text-muted">{t("app.tagline")}</p>
        </div>
        <div className="rounded-2xl border border-line bg-elev p-6 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </main>
  );
}

function useFormError() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const fromError = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : "internal_error";
    setError(t(`errors.${code}`));
  };
  return { error, setError, fromError };
}

export function LoginPage() {
  const { t } = useTranslation("auth");
  const { login } = useAuth();
  const { error, setError, fromError } = useFormError();
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      await login(String(fd.get("email")), String(fd.get("password")));
    } catch (err) {
      fromError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      footer={
        <>
          {t("login.noAccount")}{" "}
          <Link
            to="/register"
            className="font-medium text-accent-600 hover:underline dark:text-accent-300"
          >
            {t("login.register")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          name="email"
          type="email"
          label={t("fields.email")}
          autoComplete="email"
          required
          inputMode="email"
        />
        <Input
          name="password"
          type="password"
          label={t("fields.password")}
          autoComplete="current-password"
          required
        />
        {error ? (
          <p className="text-sm text-danger-500" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" block loading={busy}>
          {t("login.submit")}
        </Button>
        <Link to="/forgot-password" className="text-center text-sm text-muted hover:text-fg">
          {t("login.forgot")}
        </Link>
      </form>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const { t } = useTranslation(["auth", "common"]);
  const { register } = useAuth();
  const { error, setError, fromError } = useFormError();
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const instrument = String(fd.get("primaryInstrument") || "");
    try {
      await register({
        email: String(fd.get("email")),
        password: String(fd.get("password")),
        displayName: String(fd.get("displayName")),
        primaryInstrument: instrument || undefined,
        locale: i18n.language,
      });
    } catch (err) {
      fromError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame
      title={t("auth:register.title")}
      subtitle={t("auth:register.subtitle")}
      footer={
        <>
          {t("auth:register.hasAccount")}{" "}
          <Link
            to="/login"
            className="font-medium text-accent-600 hover:underline dark:text-accent-300"
          >
            {t("auth:register.login")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          name="displayName"
          label={t("auth:fields.displayName")}
          autoComplete="name"
          required
          maxLength={60}
        />
        <Input
          name="email"
          type="email"
          label={t("auth:fields.email")}
          autoComplete="email"
          required
          inputMode="email"
        />
        <Input
          name="password"
          type="password"
          label={t("auth:fields.password")}
          hint={t("auth:fields.passwordHint")}
          autoComplete="new-password"
          required
          minLength={8}
        />
        <Select name="primaryInstrument" label={t("auth:fields.primaryInstrument")} defaultValue="">
          <option value="">{t("common:instrument.none")}</option>
          {INSTRUMENTS.map((i) => (
            <option key={i} value={i}>
              {t(`common:instrument.${i}`)}
            </option>
          ))}
        </Select>
        {error ? (
          <p className="text-sm text-danger-500" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" block loading={busy}>
          {t("auth:register.submit")}
        </Button>
      </form>
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation("auth");
  const { error, setError, fromError } = useFormError();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await http.post<{ ok: true; devResetUrl?: string }>("/api/auth/forgot-password", {
        email: fd.get("email"),
      });
      setSent(true);
      setDevLink(res.devResetUrl ?? null);
    } catch (err) {
      fromError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame
      title={t("forgot.title")}
      subtitle={t("forgot.body")}
      footer={
        <Link
          to="/login"
          className="font-medium text-accent-600 hover:underline dark:text-accent-300"
        >
          {t("forgot.backToLogin")}
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col gap-3">
          <p className="rounded-xl bg-ok-500/10 p-3 text-sm">{t("forgot.sent")}</p>
          {devLink ? (
            <div className="rounded-xl border border-warn-500/40 bg-warn-500/10 p-3 text-sm">
              <p className="mb-2">{t("forgot.devLink")}</p>
              <a href={devLink} className="break-all font-mono text-xs underline">
                {devLink}
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Input
            name="email"
            type="email"
            label={t("fields.email")}
            autoComplete="email"
            required
            inputMode="email"
          />
          {error ? (
            <p className="text-sm text-danger-500" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" block loading={busy}>
            {t("forgot.submit")}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation("auth");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { error, setError, fromError } = useFormError();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      await http.post("/api/auth/reset-password", { token, password: fd.get("password") });
      setDone(true);
      setTimeout(() => navigate("/login"), 1500);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "invite_invalid" || err.code === "not_found"))
        setError(t("reset.invalid"));
      else fromError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title={t("reset.title")}>
      {done ? (
        <p className="rounded-xl bg-ok-500/10 p-3 text-sm">{t("reset.success")}</p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Input
            name="password"
            type="password"
            label={t("fields.password")}
            hint={t("fields.passwordHint")}
            autoComplete="new-password"
            required
            minLength={8}
          />
          {error ? (
            <p className="text-sm text-danger-500" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" block loading={busy} disabled={!token}>
            {t("reset.submit")}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
