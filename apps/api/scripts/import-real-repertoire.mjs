#!/usr/bin/env node
/**
 * Adds the real repertoire (seed/real-repertoire.json) to a band through the BandSync REST API.
 *
 * Create-only and idempotent: songs are matched by externalId, references by URL, materials by
 * (type, instrument), the repertoire by name and its items by song. Nothing that already exists is
 * modified, so edits made by the band (tempo, key, notes, uploaded material) are never overwritten.
 *
 *   BANDSYNC_URL=http://localhost:5173 BANDSYNC_EMAIL=… BANDSYNC_PASSWORD=… \
 *     node scripts/import-real-repertoire.mjs
 *
 * Optional: BANDSYNC_BAND (default "Sala 3"), BANDSYNC_ACCESS_KEY (staging gate),
 * BANDSYNC_CREDENTIALS=path to .staging/credentials.txt (reads the access key and Ana's password),
 * --dry-run (report only), --archive-fictional (soft-delete the fictional demo songs and their two
 * demo repertoires; reversible in the database, run only with the band's authorization).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(root, "seed", "real-repertoire.json"), "utf8"));
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const ARCHIVE = args.has("--archive-fictional");
const FICTIONAL_SONGS = ["Luz da Garagem", "Quinta às Oito", "Contagem Regressiva"];
const FICTIONAL_REPERTOIRES = ["Ensaio de quinta", "Show do bar"];

const base = process.env.BANDSYNC_URL?.replace(/\/$/, "");
let email = process.env.BANDSYNC_EMAIL;
let password = process.env.BANDSYNC_PASSWORD;
let accessKey = process.env.BANDSYNC_ACCESS_KEY;
const bandName = process.env.BANDSYNC_BAND ?? "Sala 3";
if (process.env.BANDSYNC_CREDENTIALS) {
  const text = readFileSync(process.env.BANDSYNC_CREDENTIALS, "utf8");
  accessKey ??= /Access key[^:]*:\s*(\S+)/.exec(text)?.[1];
  email ??= "ana@bandsync.demo";
  password ??= new RegExp(`${email.replace(/\./g, "\\.")}\\s+(\\S+)`).exec(text)?.[1];
}
if (!base || !email || !password) {
  console.error(
    "Set BANDSYNC_URL, BANDSYNC_EMAIL and BANDSYNC_PASSWORD (or BANDSYNC_CREDENTIALS).",
  );
  process.exit(2);
}

const jar = new Map();
function remember(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      cookie: cookie(),
      origin: base,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  remember(res);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}

const report = { songs: {}, repertoire: null, archived: [] };
const bump = (song, key) => {
  report.songs[song] ??= { song: "existing", referencesAdded: 0, materialsAdded: 0 };
  if (key === "song") report.songs[song].song = DRY ? "would create" : "created";
  else report.songs[song][key] += 1;
};

// 1. Staging gate (only when a key is given) and login.
if (accessKey) {
  const res = await fetch(`${base}/__access`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: accessKey, next: "/" }),
  });
  remember(res);
  if (res.status !== 303) throw new Error(`access gate refused the key (${res.status})`);
}
await call("POST", "/api/auth/login", { email, password });

// 2. Band.
const { bands } = await call("GET", "/api/bands");
const band = bands.find((b) => b.name === bandName);
if (!band) throw new Error(`band "${bandName}" not found for ${email}`);
if (!band.myPermissions.canEditRepertoire)
  throw new Error(`${email} cannot edit the repertoire of "${bandName}"`);
const B = `/api/bands/${band.id}`;

// 3. Songs, references and materials.
const { songs: existing } = await call("GET", `${B}/songs`);
const songIds = [];
for (const s of data.songs) {
  let song = existing.find((x) => x.externalId === s.externalId);
  if (!song) {
    bump(s.title, "song");
    if (DRY) {
      songIds.push(null);
      continue;
    }
    const {
      externalId,
      title,
      artist,
      composer,
      referenceRecording,
      referenceYear,
      durationSeconds,
    } = s;
    const payload = {
      externalId,
      title,
      artist,
      composer,
      referenceRecording,
      referenceYear,
      durationSeconds,
      originalBpm: s.originalBpm,
      originalBpmStatus: s.originalBpmStatus,
      originalKey: s.originalKey,
      originalKeyStatus: s.originalKeyStatus,
      originalTimeSignature: s.originalTimeSignature,
      metadataSources: s.metadataSources,
      version: s.version,
    };
    song = (await call("POST", `${B}/songs`, payload)).song;
  } else {
    report.songs[s.title] ??= { song: "existing", referencesAdded: 0, materialsAdded: 0 };
  }
  songIds.push(song.id);

  const detail = await call("GET", `${B}/songs/${song.id}`);
  const urls = new Set(detail.song.references.map((r) => r.url));
  for (const r of s.references) {
    if (urls.has(r.url)) continue;
    bump(s.title, "referencesAdded");
    if (!DRY) await call("POST", `${B}/songs/${song.id}/references`, r);
  }
  const slots = new Set(detail.materials.map((m) => `${m.type}|${m.instrument ?? ""}`));
  for (const m of s.materials) {
    if (slots.has(`${m.type}|${m.instrument ?? ""}`)) continue;
    bump(s.title, "materialsAdded");
    if (!DRY) await call("POST", `${B}/songs/${song.id}/materials`, { ...m, status: "pending" });
  }
}

// 4. Repertoire in the requested order (append missing songs; never reorders an existing list).
const { repertoires } = await call("GET", `${B}/repertoires`);
let rep = repertoires.find((r) => r.name === data.repertoire.name);
if (!rep) {
  report.repertoire = DRY ? "would create" : "created";
  if (!DRY) rep = (await call("POST", `${B}/repertoires`, data.repertoire)).repertoire;
} else {
  report.repertoire = "existing";
}
if (rep && !DRY) {
  const full = (await call("GET", `${B}/repertoires/${rep.id}`)).repertoire;
  const present = new Set(full.items.map((i) => i.songId));
  for (const id of songIds)
    if (id && !present.has(id))
      await call("POST", `${B}/repertoires/${rep.id}/items`, { songId: id });
  const final = (await call("GET", `${B}/repertoires/${rep.id}`)).repertoire;
  report.repertoireOrder = final.items.map((i) => i.song.title);
}

// 5. Optional, authorized only: archive the fictional demo content (soft delete).
if (ARCHIVE) {
  const { songs } = await call("GET", `${B}/songs`);
  for (const s of songs.filter((x) => !x.externalId && FICTIONAL_SONGS.includes(x.title))) {
    if (!DRY) await call("DELETE", `${B}/songs/${s.id}`);
    report.archived.push(`song: ${s.title}`);
  }
  const { repertoires: reps } = await call("GET", `${B}/repertoires`);
  for (const r of reps.filter((x) => FICTIONAL_REPERTOIRES.includes(x.name))) {
    if (!DRY) await call("DELETE", `${B}/repertoires/${r.id}`);
    report.archived.push(`repertoire: ${r.name}`);
  }
}

console.log(JSON.stringify({ target: base, band: bandName, dryRun: DRY, ...report }, null, 2));
