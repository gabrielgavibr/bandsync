import {
  DEFAULT_MATERIAL_PREFERENCE,
  INSTRUMENTS,
  type Instrument,
  LOCALES,
  MATERIAL_TYPES,
  NOTATIONS,
  THEMES,
} from "@bandsync/shared";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Input, PageHeader, Segmented, Select, useToast } from "../../components/ui";
import { errorText } from "../../lib/errors";
// removed "../../lib/api";
import { useAuth } from "../auth/AuthProvider";

export function ProfilePage() {
  const { t, i18n } = useTranslation(["profile", "common", "tools"]);
  const { user, preferences, updateProfile, updatePreferences, logout } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [prefInstrument, setPrefInstrument] = useState<Instrument>(
    (user?.primaryInstrument as Instrument) ?? "guitar",
  );
  if (!user || !preferences) return null;

  const savePrefs = async (patch: Parameters<typeof updatePreferences>[0]) => {
    try {
      await updatePreferences(patch);
      toast(t("profile:saved"), "success");
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  const onProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await updateProfile({
        displayName: String(fd.get("displayName")),
        primaryInstrument: String(fd.get("primaryInstrument") || "") || null,
        secondaryInstruments: fd.getAll("secondaryInstruments").map(String),
        avatarUrl: String(fd.get("avatarUrl") || "") || null,
      });
      toast(t("common:state.saved"), "success");
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const currentPref =
    preferences.materialPreferences[prefInstrument] ?? DEFAULT_MATERIAL_PREFERENCE[prefInstrument];

  return (
    <>
      <PageHeader
        title={t("profile:title")}
        actions={
          <Button variant="outline" onClick={() => void logout()}>
            {t("common:nav.logout")}
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">{t("profile:account")}</h2>
          <form onSubmit={onProfile} className="flex flex-col gap-4" noValidate>
            <Input label={t("profile:email")} value={user.email} readOnly disabled />
            <Input
              name="displayName"
              label={t("profile:displayName")}
              defaultValue={user.displayName}
              required
              maxLength={60}
            />
            <Select
              name="primaryInstrument"
              label={t("profile:primaryInstrument")}
              defaultValue={user.primaryInstrument ?? ""}
            >
              <option value="">{t("common:instrument.none")}</option>
              {INSTRUMENTS.map((i) => (
                <option key={i} value={i}>
                  {t(`common:instrument.${i}`)}
                </option>
              ))}
            </Select>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">
                {t("profile:secondaryInstruments")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {INSTRUMENTS.map((i) => (
                  <label
                    key={i}
                    className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm has-checked:border-accent-500 has-checked:bg-accent-500/10"
                  >
                    <input
                      type="checkbox"
                      name="secondaryInstruments"
                      value={i}
                      defaultChecked={user.secondaryInstruments.includes(i)}
                      className="accent-accent-500"
                    />
                    {t(`common:instrument.${i}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <Input
              name="avatarUrl"
              type="url"
              label={`${t("profile:avatarUrl")} (${t("common:state.optional")})`}
              defaultValue={user.avatarUrl ?? ""}
            />
            <Button type="submit" loading={busy}>
              {t("common:actions.save")}
            </Button>
          </form>
        </Card>
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-5">
            <h2 className="font-semibold">{t("profile:appearance")}</h2>
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("common:language.label")}</p>
              <Segmented
                ariaLabel={t("common:language.label")}
                value={
                  (LOCALES as readonly string[]).includes(i18n.language) ? i18n.language : "en"
                }
                onChange={(v) => void savePrefs({ locale: v })}
                options={LOCALES.map((l) => ({ value: l, label: t(`common:language.${l}`) }))}
              />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("common:theme.label")}</p>
              <Segmented
                ariaLabel={t("common:theme.label")}
                value={preferences.theme}
                onChange={(v) => void savePrefs({ theme: v })}
                options={THEMES.map((th) => ({ value: th, label: t(`common:theme.${th}`) }))}
              />
            </div>
          </Card>
          <Card className="flex flex-col gap-5">
            <h2 className="font-semibold">{t("profile:music")}</h2>
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("common:notation.label")}</p>
              <Segmented
                ariaLabel={t("common:notation.label")}
                value={preferences.notation}
                onChange={(v) => void savePrefs({ notation: v })}
                options={NOTATIONS.map((n) => ({ value: n, label: t(`common:notation.${n}`) }))}
              />
            </div>
            <div>
              <p className="text-sm font-medium">{t("profile:materialPreferences")}</p>
              <p className="mb-2 text-xs text-muted">{t("profile:materialPreferencesHint")}</p>
              <Select
                label={t("profile:primaryInstrument")}
                value={prefInstrument}
                onChange={(e) => setPrefInstrument(e.target.value as Instrument)}
              >
                {INSTRUMENTS.map((i) => (
                  <option key={i} value={i}>
                    {t(`common:instrument.${i}`)}
                  </option>
                ))}
              </Select>
              <ol className="mt-3 flex flex-col gap-1.5">
                {currentPref.map((type, i) => (
                  <li
                    key={type}
                    className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-sm"
                  >
                    <span className="w-5 font-mono text-muted">{i + 1}</span>
                    <span className="flex-1">{t(`common:materialType.${type}`)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={i === 0}
                      aria-label="↑"
                      onClick={() => {
                        const next = [...currentPref];
                        [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                        void savePrefs({ materialPreferences: { [prefInstrument]: next } });
                      }}
                    >
                      ↑
                    </Button>
                  </li>
                ))}
              </ol>
              <Select
                className="mt-3"
                label={t("common:actions.add")}
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  void savePrefs({
                    materialPreferences: {
                      [prefInstrument]: [
                        ...currentPref.filter((x) => x !== e.target.value),
                        e.target.value,
                      ],
                    },
                  });
                }}
              >
                <option value="">…</option>
                {MATERIAL_TYPES.filter((m) => !currentPref.includes(m)).map((m) => (
                  <option key={m} value={m}>
                    {t(`common:materialType.${m}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label={t("profile:clickSound")}
                value={preferences.clickSound}
                onChange={(e) => void savePrefs({ clickSound: e.target.value })}
              >
                {(["beep", "wood", "tick"] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`tools:metronome.sounds.${s}`)}
                  </option>
                ))}
              </Select>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t("profile:clickVolume")}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  defaultValue={preferences.clickVolume}
                  onPointerUp={(e) =>
                    void savePrefs({ clickVolume: Number((e.target as HTMLInputElement).value) })
                  }
                  className="mt-3 accent-accent-500"
                />
              </label>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
