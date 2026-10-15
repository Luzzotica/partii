-- Developer sign-up with an email code, and review for their games.
-- Developers made before this (by an operator) are trusted: their games go
-- on the store when they publish. New ones publish into review first.
ALTER TABLE developers ADD COLUMN trusted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE developers ADD COLUMN signup TEXT NOT NULL DEFAULT 'admin';
UPDATE developers SET trusted = 1;

-- review: NULL (never asked), 'pending', 'approved' or 'rejected'.
ALTER TABLE games ADD COLUMN review TEXT;
ALTER TABLE games ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE games ADD COLUMN review_at INTEGER;
CREATE INDEX games_review ON games(review) WHERE review = 'pending';

-- The admin overview reads every game's days at once.
CREATE INDEX analytics_active_day ON analytics_active(day);
CREATE INDEX analytics_sessions_all_day ON analytics_sessions(day);
