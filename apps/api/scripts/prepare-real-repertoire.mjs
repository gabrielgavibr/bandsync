#!/usr/bin/env node
/**
 * Sets the main reference recording of the real songs a band already has, through the BandSync
 * REST API — the same calls the "Add song" flow makes.
 *
 * Only what the band decided is applied:
 *   - Pérola Negra  → Natiruts part. especial Luiz Melodia, "Acústico no Rio de Janeiro" (2012),
 *                     with the YouTube link the band confirmed.
 *   - Esotérico     → Gilberto Gil, "Um Banda Um" (1982). No link was confirmed: link pending.
 *   - O Segundo Sol → Gilberto Gil, "Cássia Reggae, Vol. 1" (2022). No link confirmed: link pending.
 * A song without a confirmed link keeps its reference "link pending"; the script never picks a
 * video or track on the band's behalf.
 *
 * Idempotent and non-destructive: a song that already has that reference recording is left as it
 * is (a missing confirmed link is added to it). The band's own values (tempo, key, meter, notes,
 * material) are never changed. If a song has another reference that confirmed values or
 * arrangement work depend on, the API refuses to replace it and the script reports that instead
 * of forcing it.
 *
 *   BANDSYNC_URL=… BANDSYNC_CREDENTIALS=.staging/credentials.txt node scripts/prepare-real-repertoire.mjs
 *
 * Same environment as import-real-repertoire.mjs. --dry-run reports what would be done.
 */
import { connect } from "./lib/client.mjs";

const DRY = process.argv.includes("--dry-run");
const TARGETS = [
  {
    externalId: "bandsync:real:perola-negra",
    mbid: "0dea3c9a-ef6b-4707-90d8-685b2f4a2cd8",
    referenceUrl: "https://www.youtube.com/watch?v=JZqFoTIAJj8",
  },
  {
    externalId: "bandsync:real:esoterico",
    mbid: "8379142a-fe4e-4da2-8edf-fb493665a54f",
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
  const describe = (r) =>
    `${r.title} · ${r.artistCredit ?? ""} · ${r.link ? r.link.url : "link pending"}`;
  if (reference?.mbid === target.mbid) {
    // Right recording already. Only a confirmed link that is missing is added.
    if (target.referenceUrl && !reference.link) {
      if (!DRY)
        await call("PUT", `${AA}/songs/${song.id}/reference/link`, { url: target.referenceUrl });
      report[song.title] = {
        action: DRY ? "would add link" : "link added",
        link: target.referenceUrl,
      };
    } else {
      report[song.title] = {
        action: "skipped",
        reason: "already set",
        reference: describe(reference),
      };
    }
    continue;
  }
  if (DRY) {
    report[song.title] = {
      action: reference ? "would replace reference" : "would set reference",
      mbid: target.mbid,
      link: target.referenceUrl ?? "pending",
    };
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
        ...(target.referenceUrl ? { referenceUrl: target.referenceUrl } : {}),
        locale: "pt-BR",
      },
      [503, 409],
    );
    if (res.status === 503) await sleep(4000 * attempt);
    else started = res;
  }
  if (!started) {
    report[song.title] = { action: "failed", reason: "source unavailable, try again later" };
    continue;
  }
  if (started.status === 409) {
    // Never forced from a script: replacing a reference others depend on is a person's decision.
    report[song.title] = {
      action: "not replaced",
      reason: "confirmed values or arrangement work depend on the current reference",
      details: started.body?.error?.details ?? null,
    };
    continue;
  }
  started = started.body;

  let job = started.job;
  for (let i = 0; i < 90 && RUNNING.has(job.status); i++) {
    await sleep(1000);
    job = (await call("GET", `${AA}/jobs/${job.id}`)).job;
  }
  const after = await call("GET", `${AA}/songs/${song.id}`);
  report[song.title] = {
    action: started.replaced ? "reference replaced" : "reference set",
    job: job.status,
    reference: describe(after.recordings.find((r) => r.isReference)),
    preparation: after.preparation,
    results: after.results.map(
      (r) => `${r.kind}: ${JSON.stringify(r.value)} (${r.origin}, ${r.reviewStatus})`,
    ),
  };
}

console.log(JSON.stringify({ target: base, band: bandName, dryRun: DRY, songs: report }, null, 2));
