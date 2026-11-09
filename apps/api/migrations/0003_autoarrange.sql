-- 0003: AutoArrange foundations. Additive only: new tables and new nullable/defaulted columns.
--
-- Five things are kept apart on purpose:
--   1. the composition      -> songs (title, composer, work_mbid)
--   2. the recording        -> song_recordings (a specific performance; one is the reference)
--   3. automatic analysis   -> analysis_jobs + analysis_results (immutable; reviews never rewrite values)
--   4. reference material   -> song_references (links) and audio_assets (authorised files)
--   5. the band arrangement -> song_versions, song_sections, song_harmony, song_materials

ALTER TABLE songs ADD COLUMN work_mbid TEXT;

CREATE TABLE song_recordings (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('musicbrainz', 'manual')),
  mbid TEXT,
  title TEXT NOT NULL,
  artist_credit TEXT,
  disambiguation TEXT,
  release_title TEXT,
  release_mbid TEXT,
  release_date TEXT,
  duration_ms INTEGER,
  isrcs TEXT NOT NULL DEFAULT '[]',
  works TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '[]',
  youtube TEXT,                         -- JSON: video id, title, channel (listening via the official player)
  is_reference INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  fetched_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_song_recordings_song ON song_recordings(song_id);
CREATE UNIQUE INDEX ux_song_recordings_mbid ON song_recordings(song_id, mbid) WHERE mbid IS NOT NULL;
CREATE UNIQUE INDEX ux_song_recordings_reference ON song_recordings(song_id) WHERE is_reference = 1;

-- Audio files a member declared the band may process. Nothing is analysed without a row here.
CREATE TABLE audio_assets (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  recording_id TEXT REFERENCES song_recordings(id) ON DELETE SET NULL,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  rights_basis TEXT NOT NULL CHECK (rights_basis IN ('own_recording', 'licensed', 'permission_from_owner')),
  rights_note TEXT,
  declared_by TEXT NOT NULL REFERENCES users(id),
  declared_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_audio_assets_song ON audio_assets(song_id);

CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  recording_id TEXT REFERENCES song_recordings(id) ON DELETE SET NULL,
  audio_asset_id TEXT REFERENCES audio_assets(id) ON DELETE SET NULL,
  pipeline_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  steps TEXT NOT NULL DEFAULT '[]',     -- JSON list of step records (outcome, reason, detail, times)
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_code TEXT,
  error_message TEXT,
  cost_units INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,    -- 1 while not completed/failed/cancelled
  locale TEXT NOT NULL DEFAULT 'en',
  requested_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_analysis_jobs_song ON analysis_jobs(song_id, created_at);
CREATE INDEX idx_analysis_jobs_band ON analysis_jobs(band_id, created_at);
-- At most one active job per song + recording + audio file + pipeline version.
CREATE UNIQUE INDEX ux_analysis_jobs_active ON analysis_jobs(dedupe_key) WHERE active = 1;

-- One row per analysed or sourced fact. Values are never updated; a review changes only the
-- review_* columns, and a correction is stored as a review event plus the band's own data.
CREATE TABLE analysis_results (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  recording_id TEXT REFERENCES song_recordings(id) ON DELETE SET NULL,
  job_id TEXT REFERENCES analysis_jobs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,                  -- JSON payload
  method TEXT NOT NULL,
  method_version TEXT,
  confidence REAL,
  confidence_calibrated INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,                 -- musicbrainz | youtube | audio_analysis | user
  source_url TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_analysis_results_song ON analysis_results(song_id, kind, created_at);

-- Who confirmed or corrected what, and when. Also the change history of the band's musical data.
CREATE TABLE review_events (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  target TEXT NOT NULL,                 -- band_bpm | band_key | band_meter | …
  action TEXT NOT NULL CHECK (action IN ('confirm', 'edit', 'reject')),
  before TEXT,
  after TEXT,
  result_id TEXT REFERENCES analysis_results(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_review_events_song ON review_events(song_id, target, created_at);

-- Band arrangement map: sections gain time positions, a functional kind and cues.
-- The structure detected in a recording stays in analysis_results (kind = 'sections'); these rows
-- are the band's editable copy, so edits never erase the original analysis.
ALTER TABLE song_sections ADD COLUMN kind TEXT;
ALTER TABLE song_sections ADD COLUMN start_ms INTEGER;
ALTER TABLE song_sections ADD COLUMN end_ms INTEGER;
ALTER TABLE song_sections ADD COLUMN cues TEXT NOT NULL DEFAULT '[]';
ALTER TABLE song_sections ADD COLUMN origin TEXT NOT NULL DEFAULT 'band';
ALTER TABLE song_sections ADD COLUMN origin_result_id TEXT;

-- Band harmony map (chords by section/bar), editable; reserved for the harmony stage.
CREATE TABLE song_harmony (
  version_id TEXT PRIMARY KEY REFERENCES song_versions(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  origin TEXT NOT NULL DEFAULT 'band',  -- band | detected
  origin_result_id TEXT,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

-- Which materials were created by the preparation (as pending slots or drafts) rather than by hand.
ALTER TABLE song_materials ADD COLUMN origin TEXT NOT NULL DEFAULT 'band';
ALTER TABLE song_materials ADD COLUMN origin_job_id TEXT;
