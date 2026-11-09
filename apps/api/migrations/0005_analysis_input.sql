-- Analysis done on a band member's device (BandSync's own engine, in the browser).
-- Additive only. Each automatic result now says what it was computed from and who ran it.
ALTER TABLE analysis_results ADD COLUMN input_source TEXT;      -- microphone | audio_file | NULL (sources such as MusicBrainz)
ALTER TABLE analysis_results ADD COLUMN audio_asset_id TEXT;    -- the authorised file analysed, when input_source = 'audio_file'
ALTER TABLE analysis_results ADD COLUMN analysed_seconds REAL;  -- how much audio the estimate is based on
ALTER TABLE analysis_results ADD COLUMN created_by TEXT;        -- member whose device ran the analysis
