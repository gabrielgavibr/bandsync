import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "../components/ui/Button";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-semibold tracking-tight text-muted">404</p>
      <h1 className="text-2xl font-semibold">{t("state.notFound")}</h1>
      <p className="max-w-md text-muted">{t("state.notFoundBody")}</p>
      <Link to="/bands">
        <Button variant="secondary">{t("nav.bands")}</Button>
      </Link>
    </main>
  );
}
