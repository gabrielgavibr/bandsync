import {
  addRepertoireItemSchema,
  createRepertoireSchema,
  reorderRepertoireSchema,
  updateRepertoireSchema,
} from "@bandsync/shared";
import { Hono } from "hono";
import {
  addItem,
  createRepertoire,
  deleteRepertoire,
  getRepertoire,
  listRepertoires,
  removeItem,
  reorderItems,
  updateRepertoire,
} from "../db/repertoires";
import { getSong } from "../db/songs";
import type { AppEnv } from "../env";
import { notFound } from "../lib/errors";
import { p } from "../lib/params";
import { parseBody } from "../lib/validate";
import { requireAuth, requireMembership, requireRepertoireEditor } from "../middleware/auth";

export const repertoireRoutes = new Hono<AppEnv>();
repertoireRoutes.use("*", requireAuth, requireMembership);

repertoireRoutes.get("/", async (c) =>
  c.json({ repertoires: await listRepertoires(c.env.DB, p(c, "bandId")) }),
);

repertoireRoutes.post("/", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const input = await parseBody(c, createRepertoireSchema);
  const id = await createRepertoire(c.env.DB, bandId, c.get("user").id, input);
  return c.json({ repertoire: await getRepertoire(c.env.DB, bandId, id) }, 201);
});

repertoireRoutes.get("/:repertoireId", async (c) => {
  const rep = await getRepertoire(c.env.DB, p(c, "bandId"), p(c, "repertoireId"));
  if (!rep) throw notFound("repertoire");
  return c.json({ repertoire: rep });
});

repertoireRoutes.patch("/:repertoireId", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const input = await parseBody(c, updateRepertoireSchema);
  const ok = await updateRepertoire(c.env.DB, bandId, p(c, "repertoireId"), input);
  if (!ok) throw notFound("repertoire");
  return c.json({ repertoire: await getRepertoire(c.env.DB, bandId, p(c, "repertoireId")) });
});

repertoireRoutes.delete("/:repertoireId", requireRepertoireEditor, async (c) => {
  const ok = await deleteRepertoire(c.env.DB, p(c, "bandId"), p(c, "repertoireId"));
  if (!ok) throw notFound("repertoire");
  return c.json({ ok: true });
});

repertoireRoutes.post("/:repertoireId/items", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const repId = p(c, "repertoireId");
  const rep = await getRepertoire(c.env.DB, bandId, repId);
  if (!rep) throw notFound("repertoire");
  const input = await parseBody(c, addRepertoireItemSchema);
  const song = await getSong(c.env.DB, bandId, input.songId);
  if (!song) throw notFound("song");
  await addItem(c.env.DB, repId, input.songId, input.position, input.notes ?? null);
  return c.json({ repertoire: await getRepertoire(c.env.DB, bandId, repId) }, 201);
});

repertoireRoutes.delete("/:repertoireId/items/:songId", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const repId = p(c, "repertoireId");
  const rep = await getRepertoire(c.env.DB, bandId, repId);
  if (!rep) throw notFound("repertoire");
  await removeItem(c.env.DB, repId, p(c, "songId"));
  return c.json({ repertoire: await getRepertoire(c.env.DB, bandId, repId) });
});

repertoireRoutes.put("/:repertoireId/order", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const repId = p(c, "repertoireId");
  const rep = await getRepertoire(c.env.DB, bandId, repId);
  if (!rep) throw notFound("repertoire");
  const input = await parseBody(c, reorderRepertoireSchema);
  await reorderItems(c.env.DB, repId, input.songIds);
  return c.json({ repertoire: await getRepertoire(c.env.DB, bandId, repId) });
});
