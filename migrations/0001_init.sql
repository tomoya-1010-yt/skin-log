-- 1日1件の記録。body は記録内容の JSON (web/app.js の emptyEntry と同じ形)
CREATE TABLE entries (
  date TEXT PRIMARY KEY,        -- 日本時間の日付 (YYYY-MM-DD)
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 週次レポート。body は Claude の分析結果と集計の JSON
CREATE TABLE reports (
  id TEXT PRIMARY KEY,          -- 作成日 (YYYY-MM-DD)
  created_at TEXT NOT NULL,
  body TEXT NOT NULL
);

-- ボタンにする項目 (スキンケア・食べ物) など、アプリの設定
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL
);

-- プッシュ通知の登録
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
