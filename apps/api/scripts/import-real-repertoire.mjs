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
import { connect } from "./lib/client.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(root, "seed", "real-repertoire.json"), "utf8"));
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const ARCHIVE = args.has("--archive-fictional");
const FICTIONAL_SONGS = ["Luz da Garagem", "Quinta às Oito", "Contagem Regressiva"];
const FICTIONAL_REPERTOIRES = ["Ensaio de quinta", "Show do bar"];

const report = { songs: {}, repertoire: null, archived: [] };
const bump = (song, key) => {
  report.songs[song] ??= { song: "existing", referencesAdded: 0, materialsAdded: 0 };
  if (key === "song") report.songs[song].song = DRY ? "would create" : "created";
  else report.songs[song][key] += 1;
};

// 1–2. Staging gate, login and band.
const { base, bandName, call, bandPath: B } = await connect();

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
