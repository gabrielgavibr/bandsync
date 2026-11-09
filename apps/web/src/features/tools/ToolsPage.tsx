import { useTranslation } from "react-i18next";
import { Card, PageHeader } from "../../components/ui";
import { MetronomeTool } from "./MetronomeTool";
import { TransposerTool } from "./TransposerTool";
import { TunerTool } from "./TunerTool";

export function ToolsPage() {
  const { t } = useTranslation("tools");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold">{t("metronome.title")}</h2>
          <p className="mb-4 text-sm text-muted">{t("metronome.description")}</p>
          <MetronomeTool />
        </Card>
        <Card>
          <h2 className="text-lg font-semibold">{t("tuner.title")}</h2>
          <p className="mb-4 text-sm text-muted">{t("tuner.description")}</p>
          <TunerTool />
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="text-lg font-semibold">{t("transposer.title")}</h2>
          <p className="mb-4 text-sm text-muted">{t("transposer.description")}</p>
          <TransposerTool />
        </Card>
      </div>
    </>
  );
}
