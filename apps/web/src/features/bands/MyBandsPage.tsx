import { Plus, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
} from "../../components/ui";
import { useBands } from "./queries";

export function MyBandsPage() {
  const { t } = useTranslation(["band", "common"]);
  const bands = useBands();
  return (
    <>
      <PageHeader
        title={t("band:myBands.title")}
        subtitle={t("band:myBands.subtitle")}
        actions={
          <>
            <Link to="/join">
              <Button variant="secondary" icon={<Ticket className="size-4" />}>
                {t("band:myBands.join")}
              </Button>
            </Link>
            <Link to="/bands/new">
              <Button icon={<Plus className="size-4" />}>{t("band:myBands.create")}</Button>
            </Link>
          </>
        }
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
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bands.data.map((b) => (
            <li key={b.id}>
              <Link to={`/bands/${b.id}`} className="block h-full">
                <Card className="flex h-full flex-col gap-3 transition-colors hover:border-accent-500/60">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold">{b.name}</h2>
                      {b.genre ? <p className="text-sm text-muted">{b.genre}</p> : null}
                    </div>
                    <Badge tone={b.myRole === "admin" ? "accent" : "neutral"}>
                      {t(`common:role.${b.myRole}`)}
                    </Badge>
                  </div>
                  {b.description ? (
                    <p className="line-clamp-2 text-sm text-muted">{b.description}</p>
                  ) : null}
                  <p className="mt-auto text-sm text-muted">
                    {t("common:count.members", { count: b.memberCount })}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
