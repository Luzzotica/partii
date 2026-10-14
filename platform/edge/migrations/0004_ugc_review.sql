-- Player content review (src/api/ugc.ts): every new item, new version, edit
-- of its text or thumbnail, and report lands here; the moderator works
-- through it against the content policy (docs/CONTENT-POLICY.md).
CREATE TABLE ugc_review (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  cause TEXT NOT NULL,             -- new | version | edit | reports
  created_at INTEGER NOT NULL,
  done_at INTEGER,
  verdict TEXT,                    -- ok | hide
  note TEXT
);
CREATE INDEX ugc_review_pending ON ugc_review(done_at, seq);
CREATE INDEX ugc_review_item ON ugc_review(item_id, seq);
