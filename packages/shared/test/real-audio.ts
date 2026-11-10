import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** Decodes a fixture with ffmpeg to mono 22 050 Hz float samples. */
export function decodeFixture(name: string, from = 0, seconds?: number): Float32Array {
  const path = join(import.meta.dirname, "fixtures", "audio", name);
  const args = ["-v", "error", "-ss", String(from)];
  if (seconds) args.push("-t", String(seconds));
  args.push("-i", path, "-ac", "1", "-ar", "22050", "-f", "f32le", "-");
  let out: Buffer;
  try {
    out = execFileSync("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`ffmpeg is needed to decode test recordings (${(err as Error).message})`);
  }
  return new Float32Array(out.buffer, out.byteOffset, out.byteLength / 4).slice();
}

export const SR = 22_050;

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
