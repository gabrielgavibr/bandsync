#!/usr/bin/env node
/**
 * Runs AutoArrange (identification and sources) on the real songs a band already has, through the
 * BandSync REST API — the same calls the "Add song" wizard makes.
 *
 * Only recordings whose identity was chosen by the band are prepared:
 *   - Pérola Negra  → Natiruts part. especial Luiz Melodia, "Acústico no Rio de Janeiro" (2012)
 *   - O Segundo Sol → Gilberto Gil, "Cássia Reggae, Vol. 1" (2022)
 * Esotérico is left alone on purpose: the band has not chosen between the recordings yet, and
 * that choice is made by a person in the wizard, not by a script.
 *
 * Idempotent: a song that already has that reference recording is skipped. The band's own values
 * (tempo, key, meter, notes, material) are never changed; the pipeline only fills empty fields.
 *
 *   BANDSYNC_URL=… BANDSYNC_CREDENTIALS=.staging/credentials.txt node scripts/prepare-real-repertoire.mjs
 *
 * Same environment as import-real-repertoire.mjs. --dry-run reports what would be prepared.
 */
import { connect } from "./lib/client.mjs";

const DRY = process.argv.includes("--dry-run");
const TARGETS = [
  {
    externalId: "bandsync:real:perola-negra",
    mbid: "0dea3c9a-ef6b-4707-90d8-685b2f4a2cd8",
    youtubeUrl: "https://www.youtube.com/watch?v=JZqFoTIAJj8",
  },
  {
    externalId: "bandsync:real:o-segundo-sol",
    mbid: "790c0007-1df2-4d2e-bd34-8a772894e800",
  },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUNNING = new Set([
  "pending",
  "searching_references",
  "analyzing_audio",
  "detecting_structure",
  "preparing_materials",
]);

const { base, bandName, call, bandPath: B } = await connect();
const AA = `${B}/autoarrange`;
const { songs } = await call("GET", `${B}/songs`);
const report = {};

for (const target of TARGETS) {
  const song = songs.find((s) => s.externalId === target.externalId);
  if (!song) {
    report[target.externalId] = "song not found (run import-real-repertoire.mjs first)";
    continue;
  }
  const before = await call("GET", `${AA}/songs/${song.id}`);
  const reference = before.recordings.find((r) => r.isReference);
  if (reference?.mbid === target.mbid && before.jobs.length > 0) {
    report[song.title] = {
      action: "skipped",
      reason: "already prepared",
      job: before.jobs[0].status,
    };
    continue;
  }
  if (DRY) {
    report[song.title] = { action: "would prepare", mbid: target.mbid };
    continue;
  }

  // The source may be busy (MusicBrainz allows about one call per second): wait and try again.
  let started = null;
  for (let attempt = 1; attempt <= 4 && !started; attempt++) {
    const res = await call(
      "POST",
      `${AA}/prepare`,
      {
        songId: song.id,
        recording: { source: "musicbrainz", mbid: target.mbid },
        ...(target.youtubeUrl ? { youtubeUrl: target.youtubeUrl } : {}),
        locale: "pt-BR",
      },
      [503],
    );
    if (res.status === 503) await sleep(4000 * attempt);
    else started = res.body;
  }
  if (!started) {
    report[song.title] = { action: "failed", reason: "source unavailable, try again later" };
    continue;
  }

  let job = started.job;
  for (let i = 0; i < 90 && RUNNING.has(job.status); i++) {
    await sleep(1000);
    job = (await call("GET", `${AA}/jobs/${job.id}`)).job;
  }
  const after = await call("GET", `${AA}/songs/${song.id}`);
  report[song.title] = {
    action: started.reused ? "joined running job" : "prepared",
    job: job.status,
    steps: Object.fromEntries(job.steps.map((s) => [s.step, s.reason ?? s.outcome])),
    recording: `${started.recording.title} · ${started.recording.artistCredit ?? ""}`,
    results: after.results.map(
      (r) => `${r.kind}: ${JSON.stringify(r.value)} (${r.origin}, ${r.reviewStatus})`,
    ),
  };
}

console.log(JSON.stringify({ target: base, band: bandName, dryRun: DRY, songs: report }, null, 2));
