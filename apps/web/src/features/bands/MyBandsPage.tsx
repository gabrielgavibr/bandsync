import { Plus, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  Button,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  RowList,
} from "../../components/ui";
import { BandRow } from "./HomePage";
import { useBands } from "./queries";

/** Every band of this person, and the two ways to get another: create one, or use an invite. */
export function MyBandsPage() {
  const { t } = useTranslation(["band", "common"]);
  const bands = useBands();
  const actions = (
    <>
      <Link to="/join">
        <Button variant="secondary" icon={<Ticket className="size-4" />}>
          {t("band:myBands.joinShort")}
        </Button>
      </Link>
      <Link to="/bands/new">
        <Button icon={<Plus className="size-4" />}>{t("band:myBands.createShort")}</Button>
      </Link>
    </>
  );
  return (
    <>
      <PageHeader
        title={t("band:myBands.title")}
        subtitle={t("band:myBands.subtitle")}
        actions={actions}
      />
      {bands.isPending ? (
        <LoadingBlock />
      ) : bands.isError ? (
        <ErrorBlock error={bands.error} onRetry={() => bands.refetch()} />
      ) : bands.data.length === 0 ? (
        <EmptyState
          title={t("band:myBands.empty")}
          body={t("band:myBands.emptyHint")}
          action={
            <Link to="/bands/new">
              <Button icon={<Plus className="size-4" />}>{t("band:myBands.create")}</Button>
            </Link>
          }
        />
      ) : (
        <RowList>
          {bands.data.map((b) => (
            <BandRow key={b.id} band={b} />
          ))}
        </RowList>
      )}
    </>
  );
}
