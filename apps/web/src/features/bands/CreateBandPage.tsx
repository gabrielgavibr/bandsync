import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button, Card, Input, PageHeader, Textarea } from "../../components/ui";
import { errorText } from "../../lib/errors";
import { useCreateBand } from "./queries";

export function CreateBandPage() {
  const { t } = useTranslation(["band", "common"]);
  const navigate = useNavigate();
  const create = useCreateBand();
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const band = await create.mutateAsync({
        name: String(fd.get("name")),
        description: String(fd.get("description") || "") || undefined,
        genre: String(fd.get("genre") || "") || undefined,
      });
      navigate(`/bands/${band.id}/invite`);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <>
      <PageHeader
        title={t("band:create.title")}
        subtitle={t("band:create.subtitle")}
        backTo="/bands"
      />
      <Card className="max-w-xl">
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Input name="name" label={t("band:fields.name")} required maxLength={80} autoFocus />
          <Input
            name="genre"
            label={`${t("band:fields.genre")} (${t("common:state.optional")})`}
            maxLength={80}
          />
          <Textarea
            name="description"
            label={`${t("band:fields.description")} (${t("common:state.optional")})`}
            maxLength={1000}
          />
          {error ? (
            <p className="text-sm text-danger-500" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" loading={create.isPending}>
            {t("band:create.submit")}
          </Button>
        </form>
      </Card>
    </>
  );
}
