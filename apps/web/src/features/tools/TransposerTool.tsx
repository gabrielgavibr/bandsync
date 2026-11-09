import { intervalBetween, type Notation, parseKey, transposeChordSheet } from "@bandsync/shared";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select, Textarea } from "../../components/ui";
import { useAuth } from "../auth/AuthProvider";
import { CopyButton } from "../bands/InvitePage";

const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export function TransposerTool() {
  const { t } = useTranslation("tools");
  const { preferences } = useAuth();
  const [from, setFrom] = useState("D");
  const [to, setTo] = useState("C");
  const [input, setInput] = useState("");
  const out = useMemo(() => {
    const a = parseKey(from);
    const b = parseKey(to);
    if (!a || !b) return input;
    return transposeChordSheet(input, {
      semitones: intervalBetween(a, b),
      targetKey: b,
      notation: (preferences?.notation as Notation) ?? "english",
    });
  }, [from, to, input, preferences?.notation]);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label={t("transposer.from")}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {KEYS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
          <Select label={t("transposer.to")} value={to} onChange={(e) => setTo(e.target.value)}>
            {KEYS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
        </div>
        <Textarea
          label={t("transposer.input")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("transposer.placeholder")}
          className="font-mono"
          rows={12}
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t("transposer.output")}</span>
          <CopyButton text={out} label={t("transposer.copy")} />
        </div>
        <pre
          className="min-h-72 flex-1 whitespace-pre-wrap rounded-xl border border-line bg-sunken p-3 font-mono text-sm leading-relaxed"
          data-testid="transposer-output"
        >
          {out}
        </pre>
      </div>
    </div>
  );
}
