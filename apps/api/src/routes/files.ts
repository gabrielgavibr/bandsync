import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@bandsync/shared";
import { Hono } from "hono";
import { audit } from "../db/audit";
import { getFile, insertFile, listFiles, softDeleteFile, toFileDto } from "../db/files";
import type { AppEnv } from "../env";
import { ApiError, notFound } from "../lib/errors";
import { p } from "../lib/params";
import { requireAuth, requireMembership, requireRepertoireEditor } from "../middleware/auth";

export const fileRoutes = new Hono<AppEnv>();
fileRoutes.use("*", requireAuth, requireMembership);

fileRoutes.get("/", async (c) => c.json({ files: await listFiles(c.env.DB, p(c, "bandId")) }));

fileRoutes.post("/", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const length = Number(c.req.header("content-length") ?? "0");
  if (length > MAX_UPLOAD_BYTES + 4096) throw new ApiError("payload_too_large");
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    throw new ApiError("validation_error", "multipart field 'file' is required");
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError("payload_too_large");
  const contentType = file.type || "application/octet-stream";
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(contentType)) {
    throw new ApiError("unsupported_media", `unsupported content type ${contentType}`);
  }
  const safeName = file.name.replace(/[^\w.\- ()À-ɏ]/gu, "_").slice(0, 120) || "file";
  const row = await insertFile(c.env.DB, {
    bandId,
    name: safeName,
    contentType,
    size: file.size,
    createdBy: c.get("user").id,
  });
  await c.env.FILES.put(row.r2_key, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { bandId, fileId: row.id },
  });
  await audit(c.env.DB, {
    bandId,
    actorUserId: c.get("user").id,
    action: "file.uploaded",
    targetType: "file",
    targetId: row.id,
  });
  return c.json({ file: toFileDto(row) }, 201);
});

/** Streams a private file; access is verified through band membership on every request. */
fileRoutes.get("/:fileId", async (c) => {
  const bandId = p(c, "bandId");
  const row = await getFile(c.env.DB, bandId, p(c, "fileId"));
  if (!row) throw notFound("file");
  const obj = await c.env.FILES.get(row.r2_key);
  if (!obj) throw notFound("file");
  const headers = new Headers();
  headers.set("content-type", row.content_type);
  headers.set("content-length", String(obj.size));
  headers.set("cache-control", "private, max-age=300");
  headers.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`);
  headers.set("x-content-type-options", "nosniff");
  if (obj.httpEtag) headers.set("etag", obj.httpEtag);
  return new Response(obj.body, { headers });
});

fileRoutes.delete("/:fileId", requireRepertoireEditor, async (c) => {
  const bandId = p(c, "bandId");
  const row = await getFile(c.env.DB, bandId, p(c, "fileId"));
  if (!row) throw notFound("file");
  await softDeleteFile(c.env.DB, bandId, row.id);
  await c.env.FILES.delete(row.r2_key);
  return c.json({ ok: true });
});
