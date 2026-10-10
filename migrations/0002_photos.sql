-- 顔写真。画像そのものは R2 (PHOTOS) の photos/<date>.jpg に置き、ここには一覧だけ持つ
CREATE TABLE photos (
  date TEXT PRIMARY KEY,        -- 日本時間の日付 (1日1枚)
  uploaded_at TEXT NOT NULL,
  size INTEGER NOT NULL
);
