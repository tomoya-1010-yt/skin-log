-- 使っている化粧品・日用品。body は商品名・種類・使用期間・成分・成分チェックの JSON
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,         -- pending (成分の調査待ち) | done | not_found
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX products_status ON products (status);
