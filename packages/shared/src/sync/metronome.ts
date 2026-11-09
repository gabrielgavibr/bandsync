/**
 * Pure timeline math for the shared metronome.
 *
 * The running timeline is described by a single anchor: beat `beatIndex` happens at
 * `serverMs`, and beats are `60000 / bpm` ms apart from there. Beat 0 is the first beat
 * of the song; negative indices are the count-in. A tempo change is expressed by a new
 * anchor placed on a future bar boundary, so no beat ever moves audibly.
 */
export interface TempoAnchor {
  serverMs: number;
  beatIndex: number;
  bpm: number;
}

export interface MeterSpec {
  beatsPerBar: number;
  countInBars: number;
  /** Clicks per beat: 1 = quarter, 2 = eighths, 3 = triplets, 4 = sixteenths. */
  subdivision: 1 | 2 | 3 | 4;
}

export function beatDurationMs(bpm: number): number {
  return 60000 / bpm;
}

export function beatTimeMs(anchor: TempoAnchor, beatIndex: number): number {
  return anchor.serverMs + (beatIndex - anchor.beatIndex) * beatDurationMs(anchor.bpm);
}

/** Fractional beat index at a given server time. */
export function beatIndexAt(anchor: TempoAnchor, serverMs: number): number {
  return anchor.beatIndex + (serverMs - anchor.serverMs) / beatDurationMs(anchor.bpm);
}

export interface BeatInfo {
  beatIndex: number;
  isCountIn: boolean;
  /** 1-based bar number within the song (count-in bars are negative, e.g. -1 for the last count-in bar). */
  bar: number;
  /** 1-based beat within the bar. */
  beatInBar: number;
  accent: boolean;
}

export function describeBeat(beatIndex: number, beatsPerBar: number): BeatInfo {
  const bpb = Math.max(1, beatsPerBar);
  const barFloor = Math.floor(beatIndex / bpb);
  const beatInBar = ((beatIndex % bpb) + bpb) % bpb;
  const isCountIn = beatIndex < 0;
  return {
    beatIndex,
    isCountIn,
    bar: isCountIn ? barFloor : barFloor + 1,
    beatInBar: beatInBar + 1,
    accent: beatInBar === 0,
  };
}

/** Start anchor for a fresh start: the count-in begins at `startAtServerMs`. */
export function startAnchor(startAtServerMs: number, bpm: number, meter: MeterSpec): TempoAnchor {
  return { serverMs: startAtServerMs, beatIndex: -meter.countInBars * meter.beatsPerBar, bpm };
}

/**
 * Compute a new anchor that changes the tempo at the first bar boundary at or after
 * `notBeforeServerMs`. Returns null when the timeline is not running.
 */
export function retimeAtNextBar(
  anchor: TempoAnchor,
  beatsPerBar: number,
  newBpm: number,
  notBeforeServerMs: number,
): TempoAnchor {
  const fractional = beatIndexAt(anchor, notBeforeServerMs);
  const bpb = Math.max(1, beatsPerBar);
  let boundary = Math.ceil(fractional / bpb) * bpb + 0; // +0 normalises -0
  if (boundary < 0 && fractional < 0) {
    // During count-in, change at the song start to keep the count predictable.
    boundary = 0;
  }
  if (Object.is(boundary, -0)) boundary = 0;
  return { serverMs: beatTimeMs(anchor, boundary), beatIndex: boundary, bpm: newBpm };
}

/**
 * Enumerate click events (beats and subdivisions) with their server times in [fromMs, toMs).
 * Used by the audio scheduler with a lookahead window.
 */
export interface ClickEvent {
  serverMs: number;
  beatIndex: number;
  /** 0 for the beat itself, 1..subdivision-1 for sub-clicks. */
  sub: number;
  info: BeatInfo;
}

export function clicksBetween(
  anchor: TempoAnchor,
  meter: MeterSpec,
  fromMs: number,
  toMs: number,
): ClickEvent[] {
  const out: ClickEvent[] = [];
  if (toMs <= fromMs) return out;
  const beatMs = beatDurationMs(anchor.bpm);
  const subMs = beatMs / meter.subdivision;
  const firstIndex = Math.floor(beatIndexAt(anchor, fromMs) * meter.subdivision) - 1;
  for (let i = firstIndex; ; i += 1) {
    const beatIndex = Math.floor(i / meter.subdivision);
    const sub = ((i % meter.subdivision) + meter.subdivision) % meter.subdivision;
    const t = beatTimeMs(anchor, beatIndex) + sub * subMs;
    if (t >= toMs) break;
    if (t < fromMs) continue;
    // Do not generate clicks before the count-in starts.
    if (beatIndex < -meter.countInBars * meter.beatsPerBar) continue;
    out.push({ serverMs: t, beatIndex, sub, info: describeBeat(beatIndex, meter.beatsPerBar) });
  }
  return out;
}
