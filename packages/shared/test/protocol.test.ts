import { describe, expect, it } from "vitest";
import {
  clientMessageSchema,
  deriveStatus,
  initialSessionState,
  isNewer,
} from "../src/protocol/rehearsal";
import { startAnchor } from "../src/sync/metronome";

describe("rehearsal protocol", () => {
  it("validates client messages", () => {
    expect(clientMessageSchema.safeParse({ type: "set_tempo", bpm: 120 }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: "set_tempo", bpm: 1000 }).success).toBe(false);
    expect(
      clientMessageSchema.safeParse({ type: "set_time_signature", beatsPerBar: 7, beatUnit: 8 })
        .success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({ type: "set_time_signature", beatsPerBar: 7, beatUnit: 5 })
        .success,
    ).toBe(false);
    expect(clientMessageSchema.safeParse({ type: "fly" }).success).toBe(false);
  });

  it("derives the musical status", () => {
    const s = initialSessionState("s1", "b1", 0);
    expect(deriveStatus(s, 0)).toBe("created");
    s.participants.push({
      userId: "u1",
      displayName: "A",
      instrument: null,
      avatarUrl: null,
      connected: true,
      audioEnabled: true,
      ready: false,
      isAdmin: true,
      canControl: true,
      joinedAt: 0,
      lastSeenAt: 0,
    });
    expect(deriveStatus(s, 0)).toBe("waiting");
    s.currentSong = {
      songId: "x",
      versionId: "v",
      title: "T",
      artist: null,
      bpm: 100,
      beatsPerBar: 4,
      beatUnit: 4,
      key: null,
      repertoireIndex: null,
    };
    expect(deriveStatus(s, 0)).toBe("ready");
    s.metronome.running = true;
    s.metronome.anchor = startAnchor(1000, 120, { beatsPerBar: 4, countInBars: 1, subdivision: 1 });
    expect(deriveStatus(s, 1500)).toBe("counting_in");
    expect(deriveStatus(s, 3500)).toBe("playing");
    s.status = "ended";
    expect(deriveStatus(s, 3500)).toBe("ended");
  });

  it("orders events by seq", () => {
    expect(isNewer(5, 6)).toBe(true);
    expect(isNewer(5, 5)).toBe(false);
    expect(isNewer(5, 4)).toBe(false);
  });
});
