import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Card, PageHeader, Segmented } from "../../components/ui";
import { useIsPhone } from "../../lib/useIsPhone";
import { MetronomeTool } from "./MetronomeTool";
import { TransposerTool } from "./TransposerTool";
import { TunerTool } from "./TunerTool";

const TOOLS = ["metronome", "tuner", "transposer"] as const;
type Tool = (typeof TOOLS)[number];

/**
 * The musical tools. On a phone one tool is shown at a time (chosen by a switch at the top, or
 * by a link such as /tools?tool=tuner), so each fits the screen; larger screens show them all.
 */
export function ToolsPage() {
  const { t } = useTranslation("tools");
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const asked = params.get("tool") as Tool | null;
  const tool: Tool = asked && TOOLS.includes(asked) ? asked : "metronome";

  if (phone) {
    return (
      <div className="flex flex-col gap-3" data-testid="tools" data-tool={tool}>
        <h1 className="sr-only">{t("title")}</h1>
        <Segmented<Tool>
          block
          ariaLabel={t("title")}
          value={tool}
          onChange={(v) => setParams({ tool: v }, { replace: true })}
          options={[
            { value: "metronome", label: t("metronome.title") },
            { value: "tuner", label: t("tuner.short") },
            { value: "transposer", label: t("transposer.title") },
          ]}
        />
        <Card className="min-w-0 p-3">
          {tool === "metronome" ? (
            <MetronomeTool />
          ) : tool === "tuner" ? (
            <TunerTool />
          ) : (
            <TransposerTool />
          )}
        </Card>
      </div>
    );
  }
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" data-testid="tools">
        <Card className="min-w-0">
          <h2 className="text-lg font-semibold">{t("metronome.title")}</h2>
          <p className="mb-4 text-sm text-muted">{t("metronome.description")}</p>
          <MetronomeTool />
        </Card>
        <Card className="min-w-0">
          <h2 className="text-lg font-semibold">{t("tuner.title")}</h2>
          <p className="mb-4 text-sm text-muted">{t("tuner.description")}</p>
          <TunerTool />
        </Card>
        <Card className="min-w-0 lg:col-span-2">
          <h2 className="text-lg font-semibold">{t("transposer.title")}</h2>
          <p className="mb-4 text-sm text-muted">{t("transposer.description")}</p>
          <TransposerTool />
        </Card>
      </div>
    </>
  );
}
