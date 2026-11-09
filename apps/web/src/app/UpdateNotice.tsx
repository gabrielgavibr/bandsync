import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui";

const CHECK_EVERY_MS = 15 * 60_000;

/**
 * BandSync is installed as an app: its service worker keeps the interface it downloaded. After a
 * new version is published, a page that stays open (or an installed app brought back from the
 * background) keeps running the old interface against the new server until it is reloaded.
 *
 * This checks for a new version when the app comes back to the foreground and every 15 minutes,
 * and when the new version has taken over, asks the person to reload. It never reloads on its
 * own: a reload in the middle of a live rehearsal would stop the click.
 */
export function useAppUpdate(): { available: boolean; reload: () => void } {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!sw) return;
    // The first install also fires "controllerchange"; only a replacement is an update.
    const hadController = !!sw.controller;
    const onChange = () => {
      if (hadController) setAvailable(true);
    };
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void sw
        .getRegistration()
        .then((r) => r?.update())
        .catch(() => undefined);
    };
    sw.addEventListener("controllerchange", onChange);
    document.addEventListener("visibilitychange", check);
    const id = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      sw.removeEventListener("controllerchange", onChange);
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(id);
    };
  }, []);
  return { available, reload: () => window.location.reload() };
}

export function UpdateNotice() {
  const { t } = useTranslation();
  const { available, reload } = useAppUpdate();
  if (!available) return null;
  return (
    <div
      role="status"
      data-testid="update-notice"
      className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-2xl border border-accent-500/50 bg-elev p-3 shadow-2xl sm:bottom-4"
    >
      <p className="min-w-0 flex-1 text-sm">{t("update.body")}</p>
      <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={reload}>
        {t("update.reload")}
      </Button>
    </div>
  );
}
