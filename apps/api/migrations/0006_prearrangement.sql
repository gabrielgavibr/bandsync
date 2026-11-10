-- Pre-arrangement of a recording and the band's own arrangement. Additive only.
--
-- recording_arrangements: what was identified in the reference recording (the "pré-arranjo da
-- gravação"). Rows are never edited: a new analysis adds a row, and the band's arrangement keeps
-- pointing at the one it started from.
CREATE TABLE recording_arrangements (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  recording_id TEXT REFERENCES song_recordings(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('audio_file', 'microphone', 'member_marks')),
  audio_asset_id TEXT REFERENCES audio_assets(id) ON DELETE SET NULL,
  engine TEXT NOT NULL,                 -- e.g. bandsync-browser
  version TEXT NOT NULL,                -- e.g. prearrange-v1
  data TEXT NOT NULL,                   -- JSON: sections, chords by bar, tempo, meter, key
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_recording_arrangements_song ON recording_arrangements(song_id, created_at);

-- The band's arrangement lives in song_sections (one row per section, in playing order).
ALTER TABLE song_sections ADD COLUMN label TEXT;                      -- repetition letter, when kept
ALTER TABLE song_sections ADD COLUMN chords TEXT NOT NULL DEFAULT '[]'; -- JSON: one chord per bar

ALTER TABLE song_versions ADD COLUMN arrangement_base_id TEXT;        -- recording_arrangements.id it started from
ALTER TABLE song_versions ADD COLUMN arrangement_transpose INTEGER NOT NULL DEFAULT 0; -- semitones
ALTER TABLE song_versions ADD COLUMN arrangement_updated_by TEXT;
ALTER TABLE song_versions ADD COLUMN arrangement_updated_at TEXT;
