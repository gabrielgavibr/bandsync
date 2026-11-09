-- 0002: represent real recordings and incomplete material honestly.
-- Additive only: new nullable/defaulted columns and one new table. No existing data is changed.

-- Reference recording and authorship (distinct from the band's own version).
ALTER TABLE songs ADD COLUMN composer TEXT;
ALTER TABLE songs ADD COLUMN reference_recording TEXT;          -- album / project / session of the reference
ALTER TABLE songs ADD COLUMN reference_year INTEGER;
ALTER TABLE songs ADD COLUMN original_time_signature TEXT;      -- e.g. "4/4", only when a source states it
-- How trustworthy the reference values are: unknown | estimated | confirmed.
ALTER TABLE songs ADD COLUMN original_bpm_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE songs ADD COLUMN original_key_status TEXT NOT NULL DEFAULT 'unknown';
-- JSON array of { field, value, url, note } documenting where each fact came from.
ALTER TABLE songs ADD COLUMN metadata_sources TEXT NOT NULL DEFAULT '[]';

-- Whether the band has confirmed the meter of its version (the column itself must stay numeric).
ALTER TABLE song_versions ADD COLUMN meter_confirmed INTEGER NOT NULL DEFAULT 1;

-- Materials can be placeholders that still need to be written or imported.
ALTER TABLE song_materials ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';   -- ready | pending
ALTER TABLE song_materials ADD COLUMN is_example INTEGER NOT NULL DEFAULT 0;  -- original demo content, not a transcription

CREATE TABLE song_references (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,          -- official_video | official_audio | metadata | chords | tabs | lyrics | article | other
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (song_id, url)
);
CREATE INDEX idx_song_references_song ON song_references(song_id, position);
