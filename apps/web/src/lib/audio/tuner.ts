/**
 * The tuner's decisions, separate from the microphone and the screen so they can be tested with
 * known signals: is there enough signal, is it a note, which note, and is it steady.
 *
 * Why the previous tuner needed the instrument right next to the phone: it refused anything
 * quieter than a fixed level (-40 dBFS). With the browser's voice processing turned off (which a
 * tuner needs: automatic gain and noise suppression distort or erase sustained notes), a phone's
 * microphone delivers an acoustic guitar half a metre away well below that level.
 *
 * What decides now is how far the signal stands above the room's own noise, measured all the
 * time, not a fixed level. "Sensitivity" moves real thresholds:
 *   - how many dB above the room noise a sound must be;
 *   - the quietest level accepted at all;
 *   - how periodic the sound must be to count as a note;
 *   - how many readings in a row must agree before a note is shown.
 * A web page cannot change the microphone's hardware gain, and multiplying the samples would
 * raise noise and note alike, so no digital gain is applied to detection: pitch detection is
 * independent of loudness already. High sensitivity accepts weaker notes and asks for more
 * agreement in return, so room noise does not turn into notes.
 */
import { describeFrequency, estimatePitch } from "./pitch";

export const TUNER_WINDOW = 8192;
export const SENSITIVITY_PRESETS = { low: 20, normal: 50, high: 80 } as const;
export type SensitivityPreset = keyof typeof SENSITIVITY_PRESETS;
export const A4_MIN = 415;
export const A4_MAX = 466;

export interface TunerSettings {
  /** 0 (only strong, clear notes) .. 100 (weak notes too). */
  sensitivity: number;
  /** Reference pitch of A4 in Hz. */
  a4: number;
}

export type TunerState =
  /** Listening; nothing above the room noise. */
  | "listening"
  /** Something is sounding, too weak to analyse at this sensitivity. */
  | "weak"
  /** A note is shown. */
  | "note"
  /** Sound is there but it is not a steady note (noise, speech, several notes). */
  | "unclear"
  /** The input is saturating: readings may be wrong. */
  | "clipping";

export interface TunerReading {
  freq: number;
  note: string;
  octave: number;
  midi: number;
  cents: number;
}

export interface TunerFrame {
  state: TunerState;
  /** Input level now, dBFS (0 = full scale). */
  levelDb: number;
  /** The room's noise as tracked so far, dBFS. */
  noiseDb: number;
  /** Level a sound must reach to be analysed at the current sensitivity, dBFS. */
  gateDb: number;
  /** The room is loud enough to get in the way of quiet notes. */
  noisyRoom: boolean;
  reading: TunerReading | null;
  /** 0..1 how periodic the sound is (not how loud). */
  clarity: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));
const centsBetween = (a: number, b: number) => 1200 * Math.log2(a / b);

/** The thresholds a sensitivity setting stands for. */
export function thresholds(sensitivity: number) {
  const s = clamp(sensitivity, 0, 100) / 100;
  return {
    /** dB above the tracked room noise. */
    marginDb: lerp(16, 4, s),
    /** Quietest level accepted, dBFS. */
    floorDb: lerp(-46, -80, s),
    /** Least periodicity accepted. */
    minClarity: lerp(0.93, 0.72, s),
    /** Agreeing readings needed before a (new) note is shown. */
    confirm: s < 0.35 ? 2 : s < 0.7 ? 3 : 4,
  };
}

const HOLD_MS = 450;
const CLIP = 0.985;
const NOISY_ROOM_DB = -42;

export class TunerEngine {
  private settings: TunerSettings;
  private noiseDb = Number.NaN;
  private lastLevelDb = Number.NaN;
  private lastTime = Number.NaN;
  private locked: number | null = null;
  private history: number[] = [];
  private pendingMidi: number | null = null;
  private pendingCount = 0;
  private pendingFreqs: number[] = [];
  private lastValid = Number.NEGATIVE_INFINITY;
  private lastReading: TunerReading | null = null;

  constructor(settings: TunerSettings) {
    this.settings = { ...settings };
  }

  setSettings(settings: TunerSettings) {
    this.settings = { ...settings };
  }

  reset() {
    this.noiseDb = Number.NaN;
    this.lastLevelDb = Number.NaN;
    this.lastTime = Number.NaN;
    this.unlock();
  }

  private unlock() {
    this.locked = null;
    this.history = [];
    this.pendingMidi = null;
    this.pendingCount = 0;
    this.pendingFreqs = [];
    this.lastReading = null;
  }

  /**
   * One analysis step. `buffer` holds the most recent samples (TUNER_WINDOW of them works well);
   * `timeMs` is any steadily increasing clock.
   */
  process(buffer: Float32Array, sampleRate: number, timeMs: number): TunerFrame {
    const th = thresholds(this.settings.sensitivity);
    // Level of the latest ~45 ms: the meter must follow the hand, not the long analysis window.
    const recent = Math.min(buffer.length, Math.round(sampleRate * 0.045));
    let sum = 0;
    let peak = 0;
    for (let i = buffer.length - recent; i < buffer.length; i += 1) {
      const v = buffer[i]!;
      sum += v * v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    const levelDb = db(Math.sqrt(sum / recent));
    const dt = Number.isNaN(this.lastTime) ? 0 : Math.max(0, (timeMs - this.lastTime) / 1000);
    this.lastTime = timeMs;
    const rise = Number.isNaN(this.lastLevelDb) ? 0 : levelDb - this.lastLevelDb;
    this.lastLevelDb = levelDb;
    // Until the room has been heard, assume a quiet one: the tuner may be switched on while a
    // note is already sounding, and that note must not be taken for the room's noise.
    if (Number.isNaN(this.noiseDb)) this.noiseDb = Math.min(levelDb, -65);

    const gateDb = Math.max(th.floorDb, this.noiseDb + th.marginDb);
    const clipping = peak >= CLIP;
    let estimate: { freq: number; clarity: number } | null = null;
    // The attack of a plucked note is noise, not pitch: skip the frame where the level jumps.
    const attack = rise > 9;
    if (levelDb >= gateDb && !attack) estimate = estimatePitch(buffer, sampleRate);
    const clear = !!estimate && estimate.clarity >= th.minClarity;

    // Room noise: follows the level down at once and up slowly, and never while a note sounds.
    if (!clear) {
      if (levelDb < this.noiseDb) this.noiseDb += (levelDb - this.noiseDb) * 0.5;
      else {
        // Up slowly when close, faster when the room is plainly louder than assumed.
        const gap = levelDb - this.noiseDb;
        this.noiseDb = Math.min(levelDb, this.noiseDb + (4 + 0.8 * gap) * dt, -20);
      }
    }

    if (clear && estimate) this.accept(estimate.freq, th.confirm, timeMs);
    else if (timeMs - this.lastValid > HOLD_MS) this.unlock();

    const reading = this.lastReading;
    const state: TunerState = clipping
      ? "clipping"
      : reading
        ? "note"
        : levelDb >= gateDb
          ? "unclear"
          : levelDb > this.noiseDb + 3
            ? "weak"
            : "listening";
    return {
      state,
      levelDb,
      noiseDb: this.noiseDb,
      gateDb,
      noisyRoom: this.noiseDb > NOISY_ROOM_DB,
      reading,
      clarity: estimate?.clarity ?? 0,
    };
  }

  /** A clear estimate arrived: keep the shown note steady unless the new one insists. */
  private accept(freq: number, confirm: number, timeMs: number) {
    const midi = describeFrequency(freq, this.settings.a4).midi;
    if (this.locked !== null) {
      const centre = this.settings.a4 * 2 ** ((this.locked - 69) / 12);
      if (Math.abs(centsBetween(freq, centre)) <= 60) {
        this.history.push(freq);
        if (this.history.length > 5) this.history.shift();
        this.pendingMidi = null;
        this.pendingCount = 0;
        this.publish(timeMs);
        return;
      }
    }
    // A different note than the one shown (or none shown yet): it has to repeat.
    if (this.pendingMidi === midi) {
      this.pendingCount += 1;
      this.pendingFreqs.push(freq);
    } else {
      this.pendingMidi = midi;
      this.pendingCount = 1;
      this.pendingFreqs = [freq];
    }
    // The same note an octave (or a fifth above that) away is the usual detection slip: such a
    // jump needs twice the agreement.
    const jump = this.locked === null ? 0 : Math.abs(midi - this.locked);
    const needed = [12, 19, 24].includes(jump) ? confirm * 2 : confirm;
    if (this.pendingCount >= needed) {
      this.locked = midi;
      this.history = this.pendingFreqs.slice(-5);
      this.pendingMidi = null;
      this.pendingCount = 0;
      this.pendingFreqs = [];
      this.publish(timeMs);
    } else if (this.locked !== null && timeMs - this.lastValid <= HOLD_MS) {
      // Keep showing the steady note while the newcomer is on probation.
    } else if (this.locked !== null) {
      this.locked = null;
      this.history = [];
      this.lastReading = null;
    }
  }

  private publish(timeMs: number) {
    const sorted = [...this.history].sort((a, b) => a - b);
    const freq = sorted[Math.floor(sorted.length / 2)]!;
    const d = describeFrequency(freq, this.settings.a4);
    this.lastReading = { freq, note: d.note, octave: d.octave, midi: d.midi, cents: d.cents };
    this.lastValid = timeMs;
  }
}

/** Where a level sits on the meter (0..1) between -80 dBFS and full scale. */
export const meterPosition = (levelDb: number) => clamp((levelDb + 80) / 80, 0, 1);
