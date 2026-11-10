-- First real rehearsal with a full band: personal invitations, a weekly agenda and the rehearsal
-- board. Additive only: existing rows keep working as they are.

-- Personal invitations: one private link per musician. `code` holds a hash of the link's token
-- (the token itself is shown once, when the invitation is created). `invitee_name` marks the row
-- as personal. `grants_ownership` hands the band over to whoever accepts (used when a band is set
-- up for someone who has no account yet).
ALTER TABLE band_invitations ADD COLUMN invitee_name TEXT;
ALTER TABLE band_invitations ADD COLUMN secondary_instruments TEXT;
ALTER TABLE band_invitations ADD COLUMN grants_ownership INTEGER NOT NULL DEFAULT 0;
ALTER TABLE band_invitations ADD COLUMN accepted_by TEXT REFERENCES users(id);
ALTER TABLE band_invitations ADD COLUMN accepted_at TEXT;

-- A weekly rehearsal is a rule (weekday, time on the wall, time zone), not a list of dates.
CREATE TABLE rehearsal_schedules (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  local_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  start_date TEXT NOT NULL,
  duration_minutes INTEGER,
  location TEXT,
  address TEXT,
  notes TEXT,
  repertoire_id TEXT REFERENCES repertoires(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_rehearsal_schedules_band ON rehearsal_schedules(band_id);

-- Occurrences are rows of the existing `events` table (type 'rehearsal'), created a few at a time
-- as their dates come near (`series_date`: the date the rule gave it, even if it was moved).
-- Attendance stays in `event_attendance`.
ALTER TABLE events ADD COLUMN schedule_id TEXT REFERENCES rehearsal_schedules(id);
ALTER TABLE events ADD COLUMN series_date TEXT;
ALTER TABLE events ADD COLUMN local_date TEXT;
ALTER TABLE events ADD COLUMN local_time TEXT;
ALTER TABLE events ADD COLUMN timezone TEXT;
ALTER TABLE events ADD COLUMN detached INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN cancelled_at TEXT;
CREATE UNIQUE INDEX idx_events_schedule_date ON events(schedule_id, series_date);

-- The rehearsal board: comments that belong to one rehearsal, before, during and after it.
CREATE TABLE rehearsal_comments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  song_id TEXT REFERENCES songs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_rehearsal_comments_event ON rehearsal_comments(event_id, created_at);

-- A live session knows which rehearsal it is (so the room can open that rehearsal's board).
ALTER TABLE rehearsal_sessions ADD COLUMN event_id TEXT REFERENCES events(id);
