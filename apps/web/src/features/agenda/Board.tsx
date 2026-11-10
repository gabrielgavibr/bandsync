import type { BoardCommentDto } from "@bandsync/shared";
import { BOARD_COMMENT_MAX } from "@bandsync/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Music2, Send } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ConfirmDialog, ErrorBlock, LoadingBlock, useToast } from "../../components/ui";
import { http } from "../../lib/api";
import { cn } from "../../lib/cn";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { useAuth } from "../auth/AuthProvider";
import { useSongs } from "../repertoire/queries";
import { agendaKeys, useBoard } from "./queries";

interface Pending {
  key: string;
  body: string;
  songId: string | null;
  state: "sending" | "failed";
}

/**
 * The rehearsal board: one list of comments per rehearsal, the same before, during and after the
 * live session. Kept compact so it fits a phone screen next to the music.
 */
export function Board({
  bandId,
  eventId,
  compact,
}: {
  bandId: string;
  eventId: string;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation(["agenda", "common"]);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const board = useBoard(bandId, eventId);
  const songs = useSongs(bandId);
  const [body, setBody] = useState("");
  const [songId, setSongId] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [removing, setRemoving] = useState<BoardCommentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const base = `/api/bands/${bandId}/agenda/occurrences/${eventId}/comments`;
  const count = (board.data?.length ?? 0) + pending.length;

  // Follow the conversation: new comments scroll into view.
  useEffect(() => {
    const el = listRef.current;
    if (el && count > 0) el.scrollTop = el.scrollHeight;
  }, [count]);

  const refresh = () => qc.invalidateQueries({ queryKey: agendaKeys.board(bandId, eventId) });

  const send = async (p: Pending) => {
    setPending((list) => [...list.filter((x) => x.key !== p.key), { ...p, state: "sending" }]);
    try {
      const res = await http.post<{ comment: BoardCommentDto }>(base, {
        body: p.body,
        songId: p.songId,
      });
      qc.setQueryData<BoardCommentDto[]>(agendaKeys.board(bandId, eventId), (old) =>
        old?.some((c) => c.id === res.comment.id) ? old : [...(old ?? []), res.comment],
      );
      setPending((list) => list.filter((x) => x.key !== p.key));
    } catch (err) {
      setPending((list) => list.map((x) => (x.key === p.key ? { ...x, state: "failed" } : x)));
      toast(errorText(err), "error");
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody("");
    void send({ key: crypto.randomUUID(), body: text, songId: songId || null, state: "sending" });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const current = board.data?.find((c) => c.id === editing.id);
    setBusy(true);
    try {
      await http.patch(`${base}/${editing.id}`, {
        body: editing.body,
        songId: current?.song?.id ?? null,
      });
      setEditing(null);
      await refresh();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await http.delete(`${base}/${removing.id}`);
      setRemoving(null);
      await refresh();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-col gap-2" data-testid="board">
      {board.isPending ? (
        <LoadingBlock />
      ) : board.isError ? (
        <ErrorBlock error={board.error} onRetry={() => board.refetch()} />
      ) : (
        <ol
          ref={listRef}
          className={cn(
            "flex flex-col gap-2 overflow-y-auto overscroll-contain",
            compact ? "max-h-[45dvh]" : "max-h-[60dvh]",
          )}
          aria-live="polite"
          data-testid="board-list"
        >
          {board.data.length === 0 && pending.length === 0 ? (
            <li className="rounded-xl bg-sunken px-3 py-3 text-sm text-muted">
              {t("agenda:board.empty")}
            </li>
          ) : null}
          {board.data.map((c) => (
            <li
              key={c.id}
              className={cn(
                "rounded-xl border px-3 py-2",
                c.author.id === user?.id
                  ? "border-accent-500/30 bg-accent-500/5"
                  : "border-line bg-elev",
              )}
              data-testid="board-comment"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-muted">
                <span className="font-semibold text-fg">{c.author.displayName}</span>
                <time dateTime={c.createdAt}>
                  {formatDateTime(c.createdAt, i18n.language)}
                  {c.editedAt ? ` · ${t("agenda:board.edited")}` : ""}
                </time>
              </div>
              {c.song ? (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-accent-600 dark:text-accent-300">
                  <Music2 className="size-3" aria-hidden />{" "}
                  {t("agenda:board.about", { song: c.song.title })}
                </p>
              ) : null}
              {editing?.id === c.id ? (
                <div className="mt-2 flex flex-col gap-2">
                  <textarea
                    className="min-h-20 w-full rounded-lg border border-line bg-sunken p-2 text-sm"
                    value={editing.body}
                    maxLength={BOARD_COMMENT_MAX}
                    aria-label={t("agenda:board.edit")}
                    onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={saveEdit}
                      loading={busy}
                      disabled={!editing.body.trim()}
                    >
                      {t("agenda:board.save")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      {t("agenda:board.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
              )}
              {(c.canEdit || c.canDelete) && editing?.id !== c.id ? (
                <div className="mt-1 flex gap-3 text-xs">
                  {c.canEdit ? (
                    <button
                      type="button"
                      className="min-h-8 text-muted hover:text-fg"
                      onClick={() => setEditing({ id: c.id, body: c.body })}
                    >
                      {t("agenda:board.edit")}
                    </button>
                  ) : null}
                  {c.canDelete ? (
                    <button
                      type="button"
                      className="min-h-8 text-muted hover:text-danger-500"
                      onClick={() => setRemoving(c)}
                    >
                      {t("agenda:board.delete")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
          {pending.map((p) => (
            <li
              key={p.key}
              className="rounded-xl border border-dashed border-line px-3 py-2 opacity-80"
              data-testid="board-pending"
              data-state={p.state}
            >
              <p className="whitespace-pre-wrap break-words text-sm">{p.body}</p>
              <p className="mt-1 text-xs text-muted">
                {p.state === "sending" ? (
                  t("agenda:board.sending")
                ) : (
                  <>
                    <span className="text-danger-500">{t("agenda:board.failed")}</span>{" "}
                    <button
                      type="button"
                      className="min-h-8 underline"
                      onClick={() => void send(p)}
                    >
                      {t("agenda:board.retry")}
                    </button>
                  </>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-2" aria-label={t("agenda:board.new")}>
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-12 flex-1 resize-none rounded-xl border border-line bg-sunken px-3 py-3 text-base sm:text-sm"
            rows={1}
            placeholder={t("agenda:board.placeholder")}
            aria-label={t("agenda:board.new")}
            value={body}
            maxLength={BOARD_COMMENT_MAX}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(e);
            }}
          />
          <Button
            type="submit"
            size="lg"
            aria-label={t("agenda:board.send")}
            disabled={!body.trim()}
            icon={<Send className="size-5" />}
          />
        </div>
        {(songs.data?.length ?? 0) > 0 ? (
          <select
            className="h-10 rounded-lg border border-line bg-sunken px-2 text-sm text-muted"
            aria-label={t("agenda:board.song")}
            value={songId}
            onChange={(e) => setSongId(e.target.value)}
          >
            <option value="">{t("agenda:board.noSong")}</option>
            {(songs.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        ) : null}
      </form>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        title={t("agenda:board.delete")}
        body={t("agenda:board.deleteConfirm")}
        danger
        loading={busy}
      />
    </section>
  );
}
