import { REPERTOIRE_KINDS } from "@bandsync/shared";
import { ChevronRight, ListMusic, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  PageHeader,
  RowList,
  rowClass,
  Select,
  useToast,
} from "../../components/ui";
import { errorText } from "../../lib/errors";
import { useCurrentBand } from "../bands/BandLayout";
import { useRepertoireMutations, useRepertoires } from "./queries";

export function RepertoiresPage() {
  const { t } = useTranslation(["repertoire", "common"]);
  const band = useCurrentBand();
  const reps = useRepertoires(band.id);
  const { create } = useRepertoireMutations(band.id);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const canEdit = band.myPermissions.canEditRepertoire;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await create.mutateAsync({
        name: fd.get("name"),
        kind: fd.get("kind"),
        description: String(fd.get("description") || "") || null,
      });
      setOpen(false);
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  return (
    <>
      <PageHeader
        title={t("repertoire:repertoires.title")}
        subtitle={t("repertoire:repertoires.subtitle")}
        actions={
          canEdit ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
              {t("repertoire:repertoires.create")}
            </Button>
          ) : null
        }
      />
      {reps.isPending ? (
        <LoadingBlock />
      ) : reps.isError ? (
        <ErrorBlock error={reps.error} onRetry={() => reps.refetch()} />
      ) : reps.data.length === 0 ? (
        <EmptyState
          title={t("repertoire:repertoires.empty")}
          action={
            canEdit ? (
              <Button onClick={() => setOpen(true)}>{t("repertoire:repertoires.create")}</Button>
            ) : null
          }
        />
      ) : (
        <RowList data-testid="repertoire-list">
          {reps.data.map((r) => (
            <li key={r.id}>
              <Link to={`/bands/${band.id}/repertoires/${r.id}`} className={rowClass}>
                <ListMusic className="size-5 shrink-0 text-accent-500" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate text-sm text-muted">
                    {t("repertoire:repertoires.items", { count: r.itemCount })}
                    {r.description ? ` · ${r.description}` : ""}
                  </span>
                </span>
                <Badge tone="accent">
                  {t(`repertoire:repertoires.kinds.${r.kind}`, { defaultValue: r.kind })}
                </Badge>
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </RowList>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t("repertoire:repertoires.create")}>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Input
            name="name"
            label={t("repertoire:repertoires.name")}
            required
            maxLength={80}
            autoFocus
          />
          <Select name="kind" label={t("repertoire:repertoires.kind")} defaultValue="rehearsal">
            {REPERTOIRE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`repertoire:repertoires.kinds.${k}`)}
              </option>
            ))}
          </Select>
          <Input
            name="description"
            label={`${t("repertoire:repertoires.description")} (${t("common:state.optional")})`}
            maxLength={500}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {t("common:actions.create")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
