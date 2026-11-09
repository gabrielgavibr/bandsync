import {
  createMaterialSchema,
  createReferenceSchema,
  createSongSchema,
  updateMaterialSchema,
  updateSongSchema,
} from "@bandsync/shared";
import { Hono } from "hono";
import { audit } from "../db/audit";
import { getFile } from "../db/files";
import {
  addReference,
  createMaterial,
  createSong,
  deleteMaterial,
  deleteReference,
  deleteSong,
  getMaterial,
  getSong,
  listMaterials,
  listReferences,
  listSongs,
  updateMaterial,
  updateSong,
} from "../db/songs";
import type { AppEnv } from "../env";
import { ApiError, notFound } from "../lib/errors";
import { p } from "../lib/params";
import { parseBody } from "../lib/validate";
import { requireAuth, requireMembership, requireRepertoireEditor } from "../middleware/auth";

export const songRoutes = new Hono<AppEnv>();
songRoutes.use("*", requireAuth, requireMembership);

songRoutes.get("/", async (c) => c.json({ songs: await listSongs(c.env.DB, p(c, "bandId")) }));

songRoutes.post("/", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const input = await parseBody(c, createSongSchema);
  const id = await createSong(c.env.DB, bandId, c.get("user").id, input);
  await audit(c.env.DB, {
    bandId,
    actorUserId: c.get("user").id,
    action: "song.created",
    targetType: "song",
    targetId: id,
  });
  return c.json({ song: await getSong(c.env.DB, bandId, id) }, 201);
});

songRoutes.get("/:songId", async (c) => {
  const bandId = p(c, "bandId");
  const song = await getSong(c.env.DB, bandId, p(c, "songId"));
  if (!song) throw notFound("song");
  return c.json({ song, materials: await listMaterials(c.env.DB, bandId, song.id) });
});

songRoutes.patch("/:songId", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const input = await parseBody(c, updateSongSchema);
  const ok = await updateSong(c.env.DB, bandId, p(c, "songId"), input);
  if (!ok) throw notFound("song");
  return c.json({ song: await getSong(c.env.DB, bandId, p(c, "songId")) });
});

songRoutes.delete("/:songId", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const ok = await deleteSong(c.env.DB, bandId, p(c, "songId"));
  if (!ok) throw notFound("song");
  await audit(c.env.DB, {
    bandId,
    actorUserId: c.get("user").id,
    action: "song.deleted",
    targetType: "song",
    targetId: p(c, "songId"),
  });
  return c.json({ ok: true });
});

/* ---------------- materials ---------------- */

songRoutes.get("/:songId/materials", async (c) =>
  c.json({ materials: await listMaterials(c.env.DB, p(c, "bandId"), p(c, "songId")) }),
);

songRoutes.post("/:songId/materials", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const song = await getSong(c.env.DB, bandId, p(c, "songId"));
  if (!song) throw notFound("song");
  const input = await parseBody(c, createMaterialSchema);
  // A ready material must have content; a pending one is a placeholder (an optional note is enough).
  if (input.status !== "pending" && !input.body && !input.externalUrl && !input.fileId) {
    throw new ApiError("validation_error", "a material needs a body, an external URL or a file");
  }
  if (input.fileId && !(await getFile(c.env.DB, bandId, input.fileId))) throw notFound("file");
  const id = await createMaterial(c.env.DB, song.id, song.version.id, c.get("user").id, input);
  return c.json({ material: await getMaterial(c.env.DB, bandId, song.id, id) }, 201);
});

songRoutes.patch("/:songId/materials/:materialId", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const existing = await getMaterial(c.env.DB, bandId, p(c, "songId"), p(c, "materialId"));
  if (!existing) throw notFound("material");
  const input = await parseBody(c, updateMaterialSchema);
  if (input.fileId && !(await getFile(c.env.DB, bandId, input.fileId))) throw notFound("file");
  await updateMaterial(c.env.DB, existing.id, input);
  return c.json({ material: await getMaterial(c.env.DB, bandId, existing.songId, existing.id) });
});

songRoutes.delete("/:songId/materials/:materialId", requireRepertoireEditor, async (c) => {
  const existing = await getMaterial(c.env.DB, p(c, "bandId"), p(c, "songId"), p(c, "materialId"));
  if (!existing) throw notFound("material");
  await deleteMaterial(c.env.DB, existing.id);
  return c.json({ ok: true });
});

/* ---------------- external references (links, never copied content) ---------------- */

songRoutes.get("/:songId/references", async (c) => {
  const song = await getSong(c.env.DB, p(c, "bandId"), p(c, "songId"));
  if (!song) throw notFound("song");
  return c.json({ references: await listReferences(c.env.DB, song.id) });
});

songRoutes.post("/:songId/references", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const song = await getSong(c.env.DB, bandId, p(c, "songId"));
  if (!song) throw notFound("song");
  const input = await parseBody(c, createReferenceSchema);
  const { reference, created } = await addReference(c.env.DB, song.id, c.get("user").id, input);
  return c.json({ reference, created }, created ? 201 : 200);
});

songRoutes.delete("/:songId/references/:referenceId", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const song = await getSong(c.env.DB, bandId, p(c, "songId"));
  if (!song) throw notFound("song");
  const ok = await deleteReference(c.env.DB, song.id, p(c, "referenceId"));
  if (!ok) throw notFound("reference");
  return c.json({ ok: true });
});
