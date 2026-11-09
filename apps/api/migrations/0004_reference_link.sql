-- Reference link: the band's main reference recording is chosen by pasting a link to a supported
-- platform (YouTube, YouTube Music, Spotify). Additive only: no table is rebuilt, no row is deleted.
--
-- A recording row keeps what identifies it (title, artist, optional catalogue id) and now also the
-- link the band gave for it. `source` keeps its original meaning and CHECK ('musicbrainz' | 'manual');
-- a recording identified only by its link is stored as 'manual' with `platform` set, and the API
-- reports it as identified by "link".
--
-- URLs shown to users are rebuilt from (platform, external_id); `link_url` is stored for audit.

ALTER TABLE song_recordings ADD COLUMN platform TEXT;             -- youtube | youtube_music | spotify
ALTER TABLE song_recordings ADD COLUMN external_id TEXT;          -- the platform's id of the video / track
ALTER TABLE song_recordings ADD COLUMN link_url TEXT;             -- canonical link
ALTER TABLE song_recordings ADD COLUMN link_title TEXT;           -- title exactly as the platform gave it
ALTER TABLE song_recordings ADD COLUMN link_author TEXT;          -- channel / uploader, when the platform names one
ALTER TABLE song_recordings ADD COLUMN thumbnail_url TEXT;        -- image on the platform's own host
ALTER TABLE song_recordings ADD COLUMN embeddable INTEGER;        -- 1 | 0 | NULL (unknown)
ALTER TABLE song_recordings ADD COLUMN link_checked_at TEXT;
ALTER TABLE song_recordings ADD COLUMN metadata_edited_by TEXT;   -- member who corrected title / artist by hand
ALTER TABLE song_recordings ADD COLUMN metadata_edited_at TEXT;
ALTER TABLE song_recordings ADD COLUMN reference_since TEXT;      -- when it became the reference
ALTER TABLE song_recordings ADD COLUMN retired_at TEXT;           -- when it stopped being the reference

CREATE INDEX idx_song_recordings_link ON song_recordings(song_id, platform, external_id);

-- Recordings that already carried a validated YouTube video keep it as their link.
UPDATE song_recordings
   SET platform = 'youtube',
       external_id = json_extract(youtube, '$.videoId'),
       link_url = 'https://www.youtube.com/watch?v=' || json_extract(youtube, '$.videoId'),
       link_title = json_extract(youtube, '$.title'),
       link_author = json_extract(youtube, '$.channelName'),
       thumbnail_url = 'https://i.ytimg.com/vi/' || json_extract(youtube, '$.videoId') || '/hqdefault.jpg',
       embeddable = 1,
       link_checked_at = COALESCE(fetched_at, created_at)
 WHERE youtube IS NOT NULL
   AND json_valid(youtube)
   AND length(json_extract(youtube, '$.videoId')) = 11;

UPDATE song_recordings SET reference_since = created_at WHERE is_reference = 1;
