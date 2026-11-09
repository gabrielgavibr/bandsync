-- BandSync initial schema. All timestamps are ISO-8601 UTC strings.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified_at TEXT,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  primary_instrument TEXT,
  secondary_instruments TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'en',
  theme TEXT NOT NULL DEFAULT 'system',
  notation TEXT NOT NULL DEFAULT 'english',
  material_preferences TEXT NOT NULL DEFAULT '{}',
  click_sound TEXT NOT NULL DEFAULT 'beep',
  click_volume REAL NOT NULL DEFAULT 0.8,
  time_zone TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);

CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE bands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  genre TEXT,
  image_url TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE band_members (
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  instrument TEXT,
  can_edit_repertoire INTEGER NOT NULL DEFAULT 1,
  can_manage_events INTEGER NOT NULL DEFAULT 0,
  can_control_rehearsal INTEGER NOT NULL DEFAULT 1,
  can_post_announcements INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (band_id, user_id)
);
CREATE INDEX idx_band_members_user ON band_members(user_id);

CREATE TABLE band_invitations (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('code', 'link', 'email')),
  code TEXT NOT NULL UNIQUE,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  instrument TEXT,
  locale TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_band_invitations_band ON band_invitations(band_id);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_files_band ON files(band_id);

CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  external_id TEXT,
  duration_seconds INTEGER,
  original_bpm REAL,
  original_key TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_songs_band ON songs(band_id, deleted_at);

-- The band's own arrangement of a song (key, tempo, meter) kept apart from the original reference.
CREATE TABLE song_versions (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'band',
  bpm REAL,
  key TEXT,
  beats_per_bar INTEGER NOT NULL DEFAULT 4,
  beat_unit INTEGER NOT NULL DEFAULT 4,
  notes TEXT,
  reference_url TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_song_versions_song ON song_versions(song_id, is_current);

CREATE TABLE song_sections (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  bars INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX idx_song_sections_version ON song_sections(version_id, position);

CREATE TABLE song_materials (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  instrument TEXT,
  body TEXT,
  external_url TEXT,
  file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  key TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_song_materials_song ON song_materials(song_id, deleted_at);

-- Repertoires cover every list type (general, rehearsal, setlist, in preparation, custom).
CREATE TABLE repertoires (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',
  description TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_repertoires_band ON repertoires(band_id, deleted_at);

CREATE TABLE repertoire_items (
  id TEXT PRIMARY KEY,
  repertoire_id TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  notes TEXT,
  UNIQUE (repertoire_id, song_id)
);
CREATE INDEX idx_repertoire_items_rep ON repertoire_items(repertoire_id, position);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('rehearsal', 'show', 'recording', 'meeting', 'custom')),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  location TEXT,
  description TEXT,
  repertoire_id TEXT REFERENCES repertoires(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_events_band_start ON events(band_id, starts_at);

CREATE TABLE event_attendance (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'declined')),
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('info', 'ack', 'poll')),
  title TEXT NOT NULL,
  body TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  closes_at TEXT,
  deleted_at TEXT
);
CREATE INDEX idx_announcements_band ON announcements(band_id, created_at);

CREATE TABLE announcement_acknowledgements (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE poll_options (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE poll_votes (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  voted_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);

-- Live session metadata. The live state itself lives in the Durable Object.
CREATE TABLE rehearsal_sessions (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  repertoire_id TEXT REFERENCES repertoires(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX idx_rehearsal_sessions_band ON rehearsal_sessions(band_id, status, created_at);

CREATE TABLE rehearsal_participants (
  session_id TEXT NOT NULL REFERENCES rehearsal_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_joined_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE rehearsal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES rehearsal_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  actor_user_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_rehearsal_events_session ON rehearsal_events(session_id, seq);

CREATE TABLE musical_tasks (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  song_id TEXT REFERENCES songs(id) ON DELETE SET NULL,
  assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_musical_tasks_band ON musical_tasks(band_id, status);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  band_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_logs_band ON audit_logs(band_id, created_at);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
