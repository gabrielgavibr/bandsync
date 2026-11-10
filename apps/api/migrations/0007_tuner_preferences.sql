-- Individual tuner settings (additive): how sensitive the tuner is to weak notes, and the
-- reference pitch of A4. Per user, like the other preferences; never shared with the band.
ALTER TABLE user_preferences ADD COLUMN tuner_sensitivity INTEGER NOT NULL DEFAULT 50;
ALTER TABLE user_preferences ADD COLUMN tuner_a4 REAL NOT NULL DEFAULT 440;
