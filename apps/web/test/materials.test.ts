import type { SongMaterialDto } from "@bandsync/shared";
import { describe, expect, it } from "vitest";
import { resolvePreferredMaterial } from "../src/lib/materials";

const mat = (id: string, type: string, instrument: string | null): SongMaterialDto => ({
  id,
  songId: "s",
  versionId: "v",
  type,
  title: id,
  instrument,
  body: "x",
  externalUrl: null,
  fileId: null,
  fileUrl: null,
  key: null,
  status: "ready",
  isExample: false,
  version: 1,
  createdBy: "u",
  createdAt: "",
  updatedAt: "",
});

const materials = [
  mat("lyrics", "lyrics", null),
  mat("chords", "chords", null),
  mat("gtab", "guitar_tab", "guitar"),
  mat("btab", "bass_tab", "bass"),
  mat("drums", "drum_map", "drums"),
  mat("keys-chords", "chords", "keys"),
];

const pending = (id: string, type: string, instrument: string | null): SongMaterialDto => ({
  ...mat(id, type, instrument),
  status: "pending",
  body: null,
});

describe("resolvePreferredMaterial", () => {
  it("shows each musician their own pending slot instead of shared notes", () => {
    const list = [
      pending("bass-p", "bass_tab", "bass"),
      pending("drums-p", "drum_map", "drums"),
      mat("notes", "notes", null),
    ];
    expect(resolvePreferredMaterial(list, "bass", undefined)?.id).toBe("bass-p");
    expect(resolvePreferredMaterial(list, "drums", undefined)?.id).toBe("drums-p");
    // An instrument without a slot gets the shared ready notes, never someone else's placeholder.
    expect(resolvePreferredMaterial(list, "sax", undefined)?.id).toBe("notes");
  });

  it("prefers ready over pending within the same slot, and ready material of a more preferred type", () => {
    const sameSlot = [pending("p", "bass_tab", "bass"), mat("r", "bass_tab", "bass")];
    expect(resolvePreferredMaterial(sameSlot, "bass", undefined)?.id).toBe("r");
    // Guitar prefers chords over tabs: a ready shared chord chart beats a pending guitar tab.
    const guitar = [pending("gtab-p", "guitar_tab", "guitar"), mat("chords", "chords", null)];
    expect(resolvePreferredMaterial(guitar, "guitar", undefined)?.id).toBe("chords");
  });

  it("gives each instrument its own material for the same song", () => {
    expect(resolvePreferredMaterial(materials, "vocals", undefined)?.id).toBe("lyrics");
    expect(resolvePreferredMaterial(materials, "bass", undefined)?.id).toBe("btab");
    expect(resolvePreferredMaterial(materials, "drums", undefined)?.id).toBe("drums");
    expect(resolvePreferredMaterial(materials, "keys", undefined)?.id).toBe("keys-chords");
    // Guitar default prefers chords; the generic chord chart wins over the tab.
    expect(resolvePreferredMaterial(materials, "guitar", undefined)?.id).toBe("chords");
  });

  it("respects an explicit user preference", () => {
    expect(resolvePreferredMaterial(materials, "guitar", { guitar: ["guitar_tab"] })?.id).toBe(
      "gtab",
    );
  });

  it("falls back sensibly", () => {
    expect(resolvePreferredMaterial(materials, "sax", undefined)?.id).toBe("chords");
    expect(resolvePreferredMaterial([mat("only", "notes", null)], "drums", undefined)?.id).toBe(
      "only",
    );
    expect(resolvePreferredMaterial([], "drums", undefined)).toBeNull();
  });
});
