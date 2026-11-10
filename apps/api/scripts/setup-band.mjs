#!/usr/bin/env node
/**
 * Sets up a real band on staging for someone who has no account there yet, without using any demo
 * or test account as its owner:
 *
 *   - a technical "set-up" user that cannot sign in (its password field is not a valid hash);
 *     it is recorded as the band's creator only until the owner accepts their invitation,
 *     and is never a member of the band;
 *   - the band, a weekly rehearsal (rule + the occurrence of the first date);
 *   - one personal invitation per musician (random 256-bit token; only its SHA-256 is stored);
 *     the owner's invitation is admin and hands the band over (grants_ownership);
 *   - optionally a copy of the songs of another band (versions, sections, harmony, materials,
 *     references, recordings, analyses, pre-arrangements, uploaded audio files copied in R2 under
 *     the new band) and its repertoires. The source band is only read.
 *
 * Create-only: it refuses to run if a band with the same name exists. Links are written to
 * .staging/<slug>-invites.json (git-ignored) and printed once; they are not stored anywhere else.
 *
 *   CLOUDFLARE_ACCOUNT_ID=… node scripts/setup-band.mjs scripts/bands/banda-sem-nome.json [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = process.argv[2];
const DRY = process.argv.includes("--dry-run");
if (!configPath) throw new Error("usage: setup-band.mjs <config.json> [--dry-run]");
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
// SETUP_LOCAL=1 runs the same set-up against the local development database (a rehearsal).
const LOCAL = process.env.SETUP_LOCAL === "1";
const DB = LOCAL ? "bandsync" : (cfg.database ?? "bandsync-staging");
const WHERE = LOCAL ? ["--local"] : ["--remote", "--env", cfg.env ?? "staging"];
const BUCKET = LOCAL ? "bandsync-files" : (cfg.bucket ?? "bandsync-files-staging");
const work = join(root, ".staging", "setup-tmp");
mkdirSync(work, { recursive: true });

const wrangler = (args) =>
  execFileSync("npx", ["wrangler", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });

function query(sql) {
  const out = wrangler(["d1", "execute", DB, ...WHERE, "--json", "--command", sql]);
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}

const q = (v) =>
  v === null || v === undefined
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;
const now = new Date().toISOString();
const sha = (s) => createHash("sha256").update(s).digest("hex");
const statements = [];
const insert = (table, row) => {
  const cols = Object.keys(row);
  statements.push(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => q(row[c])).join(", ")});`,
  );
};

// 0. Nothing is overwritten.
if (query(`SELECT id FROM bands WHERE name = ${q(cfg.band.name)} AND deleted_at IS NULL`).length) {
  throw new Error(`a band named "${cfg.band.name}" already exists; nothing done`);
}

// 1. The set-up user (cannot sign in) and the band, with no members until people accept.
const setupEmail = cfg.setupUser.email;
let setupId = query(`SELECT id FROM users WHERE email = ${q(setupEmail)}`)[0]?.id;
if (!setupId) {
  setupId = randomUUID();
  insert("users", {
    id: setupId,
    email: setupEmail,
    password_hash: "!no-login",
    display_name: cfg.setupUser.displayName,
    secondary_instruments: "[]",
    created_at: now,
    updated_at: now,
  });
}
const bandId = randomUUID();
insert("bands", {
  id: bandId,
  name: cfg.band.name,
  description: cfg.band.description ?? null,
  created_by: setupId,
  created_at: now,
  updated_at: now,
});

// 2. Weekly rehearsal and its first occurrence (the rest are created as their dates come near).
const s = cfg.schedule;
const scheduleId = randomUUID();
insert("rehearsal_schedules", {
  id: scheduleId,
  band_id: bandId,
  title: s.title,
  weekday: s.weekday,
  local_time: s.time,
  timezone: s.timezone,
  start_date: s.startDate,
  created_by: setupId,
  created_at: now,
  updated_at: now,
});
const first = s.firstOccurrence;
insert("events", {
  id: randomUUID(),
  band_id: bandId,
  type: "rehearsal",
  title: first.title,
  starts_at: first.startsAtUtc,
  created_by: setupId,
  created_at: now,
  updated_at: now,
  schedule_id: scheduleId,
  series_date: s.startDate,
  local_date: s.startDate,
  local_time: s.time,
  timezone: s.timezone,
  // Its own title ("… — Ensaio de 10/11/2026"): kept when the series changes.
  detached: 1,
});

// 3. Personal invitations.
const expires = new Date(Date.now() + cfg.inviteDays * 86_400_000).toISOString();
const links = [];
for (const m of cfg.members) {
  const token = randomBytes(32).toString("base64url");
  insert("band_invitations", {
    id: randomUUID(),
    band_id: bandId,
    kind: "link",
    code: `pi_${sha(token)}`,
    role: m.role,
    instrument: m.instrument,
    secondary_instruments: JSON.stringify(m.secondary ?? []),
    invitee_name: m.name,
    grants_ownership: m.owner ? 1 : 0,
    max_uses: 1,
    uses: 0,
    expires_at: expires,
    created_by: setupId,
    created_at: now,
  });
  links.push({ name: m.name, url: `${cfg.appUrl}/convite/${token}`, owner: !!m.owner });
}

// 4. Songs copied from another band (read-only on the source).
const r2Copies = [];
let songCount = 0;
if (cfg.copySongsFrom) {
  const src = cfg.copySongsFrom;
  const ids = new Map();
  const map = (id) => {
    if (!ids.has(id)) ids.set(id, randomUUID());
    return ids.get(id);
  };
  const USER_COLS = [
    "created_by",
    "declared_by",
    "updated_by",
    "reviewed_by",
    "arrangement_updated_by",
    "metadata_edited_by",
    "requested_by",
  ];
  const REF_COLS = [
    "song_id",
    "version_id",
    "recording_id",
    "file_id",
    "audio_asset_id",
    "origin_result_id",
    "arrangement_base_id",
    "repertoire_id",
  ];
  const copy = (table, rows, extra = () => ({})) => {
    for (const r of rows) {
      const row = { ...r };
      if ("id" in row) row.id = map(r.id);
      if ("band_id" in row) row.band_id = bandId;
      for (const c of USER_COLS) if (row[c]) row[c] = setupId;
      for (const c of REF_COLS) if (c in row && row[c] !== null) row[c] = ids.get(r[c]) ?? null;
      if ("job_id" in row) row.job_id = null;
      Object.assign(row, extra(r, row));
      insert(table, row);
    }
  };
  const songs = query(
    `SELECT * FROM songs WHERE band_id = ${q(src)} AND deleted_at IS NULL ORDER BY created_at`,
  );
  songCount = songs.length;
  const inSongs = `(${songs.map((x) => q(x.id)).join(", ") || "''"})`;
  for (const x of songs) map(x.id);
  const versions = query(`SELECT * FROM song_versions WHERE song_id IN ${inSongs}`);
  const inVersions = `(${versions.map((x) => q(x.id)).join(", ") || "''"})`;
  const files = query(
    `SELECT * FROM files WHERE band_id = ${q(src)} AND deleted_at IS NULL AND id IN (
       SELECT file_id FROM audio_assets WHERE song_id IN ${inSongs} AND deleted_at IS NULL
       UNION SELECT file_id FROM song_materials WHERE song_id IN ${inSongs} AND deleted_at IS NULL AND file_id IS NOT NULL)`,
  );
  const recordings = query(`SELECT * FROM song_recordings WHERE song_id IN ${inSongs}`);
  const assets = query(
    `SELECT * FROM audio_assets WHERE song_id IN ${inSongs} AND deleted_at IS NULL`,
  );
  const results = query(`SELECT * FROM analysis_results WHERE song_id IN ${inSongs}`);
  const arrangements = query(`SELECT * FROM recording_arrangements WHERE song_id IN ${inSongs}`);
  // Every id is known before any row is written, so references between them resolve.
  for (const t of [versions, files, recordings, assets, results, arrangements])
    for (const x of t) map(x.id);
  copy("files", files, (r, row) => {
    const key = `bands/${bandId}/${row.id}`;
    r2Copies.push({ from: r.r2_key, to: key, type: r.content_type });
    return { r2_key: key };
  });
  copy("songs", songs);
  copy("song_versions", versions);
  copy("song_recordings", recordings);
  copy("audio_assets", assets);
  copy("analysis_results", results);
  copy("recording_arrangements", arrangements);
  copy("song_harmony", query(`SELECT * FROM song_harmony WHERE version_id IN ${inVersions}`));
  copy("song_sections", query(`SELECT * FROM song_sections WHERE version_id IN ${inVersions}`));
  copy(
    "song_materials",
    query(`SELECT * FROM song_materials WHERE song_id IN ${inSongs} AND deleted_at IS NULL`),
  );
  copy("song_references", query(`SELECT * FROM song_references WHERE song_id IN ${inSongs}`));
  const reps = query(
    `SELECT * FROM repertoires WHERE band_id = ${q(src)} AND deleted_at IS NULL ORDER BY created_at`,
  );
  for (const x of reps) map(x.id);
  copy("repertoires", reps);
  copy(
    "repertoire_items",
    query(
      `SELECT * FROM repertoire_items WHERE repertoire_id IN (${reps.map((x) => q(x.id)).join(", ") || "''"})
       AND song_id IN ${inSongs}`,
    ),
  );
}

console.log(
  `band "${cfg.band.name}": ${links.length} invitations, ${songCount} songs, ${r2Copies.length} files, ${statements.length} rows`,
);
if (DRY) process.exit(0);

// 5. Files first (so no row points at a missing object), then all rows in one batch.
for (const f of r2Copies) {
  const tmp = join(work, "obj");
  wrangler(["r2", "object", "get", `${BUCKET}/${f.from}`, "--file", tmp, LOCAL ? "--local" : "--remote"]);
  wrangler([
    "r2",
    "object",
    "put",
    `${BUCKET}/${f.to}`,
    "--file",
    tmp,
    "--content-type",
    f.type,
    LOCAL ? "--local" : "--remote",
  ]);
  rmSync(tmp);
}
const sqlFile = join(work, "setup.sql");
writeFileSync(sqlFile, `${statements.join("\n")}\n`);
wrangler(["d1", "execute", DB, ...WHERE, "--file", sqlFile, "--yes"]);
rmSync(sqlFile);

const slug = cfg.band.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const out = join(root, ".staging", `${LOCAL ? "local-" : ""}${slug}-invites.json`);
writeFileSync(out, `${JSON.stringify({ bandId, createdAt: now, expiresAt: expires, links }, null, 2)}\n`);
console.log(`band id ${bandId}; links written to ${out}`);
