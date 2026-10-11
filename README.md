# 肌ログ

毎日の肌の状態・スキンケア・食べたもの・睡眠などを記録し、週に1回 Claude が
「悪化の原因の候補」と「おすすめアクション」をレポートにする、自分専用の PWA。

## 仕組み

Claude の呼び出しは Claude Code の CLI (`claude -p`) で行い、Claude の契約 (Pro / Max) の範囲で動く。
API キーや従量課金は使わない (my-news と同じ方式)。

```
iPhone のホーム画面アプリ (web/)
  記録: 肌の調子 / かゆみ (いつ・どこ) / ニキビ (顔の図をタップ) / スキンケア (朝・夜) /
        食べたもの / 睡眠 / ストレス / お酒 / 運動 / メモ /
        肌の気になること / ニキビの種類 / 変えたこと (化粧品・刃・枕カバーなど)
  化粧品タブ: 使っている化粧品・シャンプー・洗剤などを登録 (替えた日は「変えたこと」に自動で記録)
        ↓ 合言葉でログイン (Cookie)
Cloudflare Pages Functions (functions/api) + D1 (migrations/)
        ↑ 内部 API (INGEST_TOKEN)
GitHub Actions
  - 週次レポート (毎週月曜 7:30 JST、予備 8:30)
      1. 直近120日の記録を取得
      2. generator/stats.py が「◯◯した日の翌日はかゆみが出た割合 △% → □%」を計算
         (数字は Python で計算し、Claude には計算させない)
      3. 変えたこと (化粧品など) の前後14日と、使った製品・複数の製品に共通する成分ごとの悪化の割合を比べる
      4. Claude が集計とメモを読んで、原因の候補・良さそうな習慣・おすすめアクション・
         来週ためすこと・成分から考えられること・受診の目安を書く
      5. 保存 → プッシュ通知
  - 成分の調査 (7〜23時 JST の毎時。調査待ちの製品があるときだけ Claude を動かす)
      Claude が商品名で Web 検索 → 全成分を確認 → 刺激・ニキビ・かぶれ・乾燥の注意成分に印を付ける。
      出典 URL は検索・取得の結果に実際に出たものだけ残し、確認できなければ「見つからない」にする
      (アプリで成分表示を貼り付ければ、その成分でチェックだけし直す)
  - 記録のリマインド (毎日 21:30 JST、今日の記録がなければ通知。Claude は使わない)
```

- 前の週の記録が3日未満のときはレポートを作らず、「お休み」の通知だけ送る
- 集計は、要因を「した日」と「しなかった日」がそれぞれ3日以上ある項目だけを比べる。
  毎日使っているスキンケアのように比べられないものは候補に出ない
- 食べ物・スキンケアを1つも選ばなかった日は「食べなかった」ではなく未記録として扱う
- 記録はサーバー (D1) にだけ保存し、端末にはキャッシュしない

## 初回セットアップ

### 1. Claude Code のトークン
my-news で作ったトークンをそのまま使える。新しく作る場合は、Claude Code が使えるターミナルで次を実行し、
ブラウザで許可すると表示されるトークンを控える (有効期限1年)。
```
claude setup-token
```

### 2. Cloudflare
1. https://dash.cloudflare.com → Storage & Databases → D1 → Create → 名前 `skin-log` で作成し、
   Database ID を `wrangler.toml` の `database_id` に貼る
2. API トークンとアカウント ID は my-news と同じものを使える
   (権限: Account / Cloudflare Pages / Edit と Account / D1 / Edit)

### 3. 通知用の鍵
```
python scripts/gen_vapid.py
```
- `VAPID_PUBLIC_KEY` → `wrangler.toml` の `[vars]` に貼る (公開してよい)
- `VAPID_PRIVATE_KEY` → GitHub の Secret に登録 (公開しない)

### 4. GitHub
リポジトリを **Private** で作って push し、Settings → Secrets and variables → Actions に登録する。

| 種類 | 名前 | 値 |
|---|---|---|
| Secret | `APP_PASSPHRASE` | アプリを開くときの合言葉。推測されにくい長めの文にする (例: 単語を4つ以上つなげる) |
| Secret | `CLAUDE_CODE_OAUTH_TOKEN` | 手順1 のトークン |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare の API トークン |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント ID |
| Secret | `INGEST_TOKEN` | 分析スクリプトがアプリのデータを読むときの認証用 (ランダムな長い文字列。my-news とは別にする) |
| Secret | `VAPID_PRIVATE_KEY` | 手順3 の秘密鍵 |
| Variable | `APP_URL` | `https://skin-log.pages.dev` (デプロイ後に表示される URL) |
| Variable | `VAPID_SUBJECT` | `mailto:自分のメールアドレス` |

ランダムな文字列は次で作れる。
```
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 5. 動かす
1. Actions →「アプリのデプロイ」→ Run workflow
2. iPhone の Safari で `APP_URL` を開き、共有 →「ホーム画面に追加」
3. ホーム画面から開いて合言葉を入力 (端末ごとに1回。約1年ログインしたまま)
4. 設定タブ →「通知をオンにする」
5. 3日以上記録したら、Actions →「週次レポート」→ Run workflow で試しに作れる

## ローカルでの確認

```
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
# 画面の確認 (合言葉は dev。記録は dev/sample.py のダミー、レポートは out/ にあれば表示)
python dev/server.py
# レポート作成だけ試す (保存・通知はしない。out/ に JSON が出る)
# Claude Code にログイン済みの PC なら、トークンの設定なしで動く
.venv/Scripts/python generator/main.py weekly --dry-run
# 本物の記録で試す (設定タブ →「データを書き出す」で保存した JSON を指定)
.venv/Scripts/python generator/main.py weekly --dry-run --input skin-log-2026-10-11.json
```

## 調整したいとき

- 記録の項目・ボタン: `web/app.js` の先頭 (スキンケア・食べ物のボタンはアプリの設定タブから追加・削除できる)
- 集計のしかた (比べる要因、最低日数、日ずれ): `generator/stats.py`
- レポートの書き方: `generator/llm.py` の `report`
- 実行時刻: `.github/workflows/report.yml` / `remind.yml` の cron (UTC なので JST から9時間引く)
- モデル: 環境変数 `SKIN_MODEL` (既定 `opus`、使えないときは `SKIN_FALLBACK_MODEL` の `sonnet`)
- 合言葉を変えたら Secret `APP_PASSPHRASE` を更新して「アプリのデプロイ」を実行する (全端末がログアウトされる)
