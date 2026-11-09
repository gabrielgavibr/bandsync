import { type BandMemberDto, INSTRUMENTS, type MemberPermissions } from "@bandsync/shared";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Avatar } from "../../app/AppShell";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Select,
  Toggle,
  useToast,
} from "../../components/ui";
import { errorCode } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useAuth } from "../auth/AuthProvider";
import { useCurrentBand } from "./BandLayout";
import { useMembers, useRemoveMember, useUpdateMember } from "./queries";

const PERMISSION_KEYS: (keyof MemberPermissions)[] = [
  "canEditRepertoire",
  "canManageEvents",
  "canControlRehearsal",
  "canPostAnnouncements",
];

export function MembersPage() {
  const { t, i18n } = useTranslation(["band", "common"]);
  const band = useCurrentBand();
  const { user } = useAuth();
  const members = useMembers(band.id);
  const update = useUpdateMember(band.id);
  const remove = useRemoveMember(band.id);
  const { toast } = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<BandMemberDto | null>(null);
  const [removing, setRemoving] = useState<BandMemberDto | null>(null);
  const [leaving, setLeaving] = useState(false);
  const isAdmin = band.myRole === "admin";

  const fail = (err: unknown) => toast(t(`common:errors.${errorCode(err)}`), "error");

  return (
    <>
      <PageHeader
        title={t("band:members.title")}
        actions={
          isAdmin ? (
            <Link to={`/bands/${band.id}/invite`}>
              <Button icon={<UserPlus className="size-4" />}>{t("band:members.invite")}</Button>
            </Link>
          ) : null
        }
      />
      {members.isPending ? (
        <LoadingBlock />
      ) : members.isError ? (
        <ErrorBlock error={members.error} onRetry={() => members.refetch()} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {members.data.map((m) => {
            const me = m.userId === user?.id;
            return (
              <li key={m.userId}>
                <Card className="flex items-center gap-3">
                  <Avatar name={m.displayName} url={m.avatarUrl} className="size-11" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{m.displayName}</span>
                      {me ? (
                        <span className="text-xs text-muted">({t("band:members.you")})</span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted">
                      {m.instrument
                        ? t(`common:instrument.${m.instrument}`)
                        : t("common:instrument.none")}{" "}
                      · {t("band:members.joined", { date: formatDate(m.joinedAt, i18n.language) })}
                    </p>
                  </div>
                  <Badge tone={m.role === "admin" ? "accent" : "neutral"}>
                    {t(`common:role.${m.role}`)}
                  </Badge>
                  {isAdmin || me ? (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                      {t("common:actions.edit")}
                    </Button>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {!isAdmin || (members.data && members.data.filter((m) => m.role === "admin").length > 1) ? (
        <div className="mt-8">
          <Button variant="outline" onClick={() => setLeaving(true)}>
            {t("band:members.leave")}
          </Button>
        </div>
      ) : null}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.displayName ?? ""}>
        {editing ? (
          <MemberEditor
            member={editing}
            isAdmin={isAdmin}
            isSelf={editing.userId === user?.id}
            busy={update.isPending}
            onSave={async (patch) => {
              try {
                await update.mutateAsync({ userId: editing.userId, patch });
                setEditing(null);
              } catch (err) {
                fail(err);
              }
            }}
            onRemove={() => {
              setRemoving(editing);
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t("band:members.removeMember")}
        body={t("band:members.removeConfirm", { name: removing?.displayName ?? "" })}
        danger
        loading={remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync(removing.userId);
            setRemoving(null);
          } catch (err) {
            fail(err);
          }
        }}
      />
      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title={t("band:members.leave")}
        body={t("band:members.leaveConfirm")}
        danger
        loading={remove.isPending}
        onConfirm={async () => {
          if (!user) return;
          try {
            await remove.mutateAsync(user.id);
            navigate("/bands");
          } catch (err) {
            fail(err);
          }
        }}
      />
    </>
  );
}

function MemberEditor({
  member,
  isAdmin,
  isSelf,
  busy,
  onSave,
  onRemove,
}: {
  member: BandMemberDto;
  isAdmin: boolean;
  isSelf: boolean;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation(["band", "common"]);
  const [instrument, setInstrument] = useState(member.instrument ?? "");
  const [role, setRole] = useState(member.role);
  const [perms, setPerms] = useState<MemberPermissions>(member.permissions);
  return (
    <div className="flex flex-col gap-4">
      <Select
        label={t("band:members.instrument")}
        value={instrument}
        onChange={(e) => setInstrument(e.target.value)}
      >
        <option value="">{t("common:instrument.none")}</option>
        {INSTRUMENTS.map((i) => (
          <option key={i} value={i}>
            {t(`common:instrument.${i}`)}
          </option>
        ))}
      </Select>
      {isAdmin ? (
        <>
          <Select
            label={t("band:members.role")}
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
          >
            <option value="member">{t("common:role.member")}</option>
            <option value="admin">{t("common:role.admin")}</option>
          </Select>
          {role === "member" ? (
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t("band:members.permissions")}</legend>
              {PERMISSION_KEYS.map((k) => (
                <Toggle
                  key={k}
                  label={t(`band:members.permission.${k}`)}
                  checked={perms[k]}
                  onChange={(v) => setPerms({ ...perms, [k]: v })}
                />
              ))}
            </fieldset>
          ) : null}
        </>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2 pt-2">
        {isAdmin && !isSelf ? (
          <Button variant="danger" onClick={onRemove}>
            {t("band:members.removeMember")}
          </Button>
        ) : (
          <span />
        )}
        <Button
          loading={busy}
          onClick={() =>
            onSave(
              isAdmin
                ? {
                    instrument: instrument || null,
                    role,
                    permissions: role === "member" ? perms : undefined,
                  }
                : { instrument: instrument || null },
            )
          }
        >
          {t("common:actions.save")}
        </Button>
      </div>
    </div>
  );
}
