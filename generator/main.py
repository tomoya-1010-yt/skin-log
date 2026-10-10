"""週次レポートの作成と、記録し忘れのお知らせ。

使い方:
  python generator/main.py weekly              # 週次レポート (Actions で毎週月曜の朝)
  python generator/main.py weekly --force      # 作成済みでも作り直す
  python generator/main.py weekly --dry-run    # 保存・通知せず out/ に JSON を書くだけ (サンプルデータを使う)
  python generator/main.py weekly --dry-run --input skin-log-2026-10-11.json   # 書き出したデータで試す
  python generator/main.py remind              # 今日の記録がなければ通知 (Actions で毎晩)
"""
import argparse
import datetime as dt
import json
import pathlib
import sys

import llm
import push
import stats
from store import Store

JST = dt.timezone(dt.timedelta(hours=9))
ROOT = pathlib.Path(__file__).resolve().parent.parent
HISTORY_DAYS = 120   # 集計に使う日数
MIN_WEEK_DAYS = 3    # 対象週の記録がこれ未満ならレポートを作らない


def load_local(path, today):
    if path:
        data = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
        return {r["date"]: r["entry"] for r in data["entries"]}, (data["reports"][-1] if data.get("reports") else None)
    sys.path.insert(0, str(ROOT / "dev"))
    import sample
    return sample.entries(today), None


def weekly(args, today):
    store = None if args.dry_run else Store()
    if args.dry_run:
        entries, last_report = load_local(args.input, today)
        photo_dates = []
    else:
        reps = store.reports()
        if today in reps["ids"] and not args.force:
            print(f"{today} のレポートは作成済みなのでスキップします")
            return
        last_report = reps["latest"]
        data = store.entries(stats.shift(today, -HISTORY_DAYS))
        entries = {r["date"]: r["entry"] for r in data["entries"]}
        photo_dates = data.get("photos") or []
    entries = {d: e for d, e in entries.items() if d < today}  # 今日の分は書きかけなので使わない

    period = {"from": stats.shift(today, -7), "to": stats.shift(today, -1)}
    this_week = stats.week(entries, period["from"], period["to"])
    prev_week = stats.week(entries, stats.shift(today, -14), stats.shift(today, -8))
    print(f"対象週 {period['from']}〜{period['to']}: 記録 {this_week['days_recorded']}日 / 全体 {len(entries)}日")
    if this_week["days_recorded"] < MIN_WEEK_DAYS:
        print("記録が少ないのでレポートは作りません")
        if store:
            push.send(store, "🧴 今週のレポートはお休みです",
                      f"先週の記録が{this_week['days_recorded']}日でした。3日以上あるとレポートを作ります", "./#record",
                      tag="report")
        return

    assoc = stats.associations(entries)
    records = [stats.describe(d, entries[d]) for d in sorted(entries) if d >= stats.shift(today, -14)]
    changes = stats.change_effects(entries, today)
    since = stats.last_changes(entries, today)
    photos, photo_pair = pick_photos(store, photo_dates, period, today)
    ai = llm.report(today, period, this_week, prev_week, assoc, records, len(entries), last_report, changes, since,
                    photos)

    report = {
        "id": today,
        "created_at": dt.datetime.now(JST).isoformat(timespec="seconds"),
        "period": period,
        "data_days": len(entries),
        "week": {**this_week, "skin_avg_prev": prev_week["skin_avg"],
                 "acne_total_prev": prev_week["acne_total"] if prev_week["days_recorded"] else None},
        "associations": assoc,
        "changes": changes,
        "photos": photo_pair,
        "ai": ai,
    }
    if args.dry_run:
        out = ROOT / "out"
        out.mkdir(exist_ok=True)
        (out / f"report-{today}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"wrote out/report-{today}.json")
        return
    store.put_report(report)
    top = ai["suspects"][0]["factor"] if ai["suspects"] else "今週の振り返り"
    push.send(store, "🧴 週次レポートが届きました", f"気になる要因: {top}" if ai["suspects"] else top,
              "./#report", tag="report")


def pick_photos(store, dates, period, today):
    """今週の写真 (対象週〜今日の最新) と、比べる前回の写真 (対象週より前の最新) を取ってくる。"""
    this = max((d for d in dates if period["from"] <= d <= today), default=None)
    if not this or not store:
        return [], {"this": None, "prev": None}
    prev = max((d for d in dates if d < period["from"]), default=None)
    picked = [("previous.jpg", prev), ("this_week.jpg", this)] if prev else [("this_week.jpg", this)]
    print(f"写真: {', '.join(d for _, d in picked)}")
    return [(name, d, store.photo(d)) for name, d in picked], {"this": this, "prev": prev}


def remind(args, today):
    if args.dry_run:
        print("remind は --dry-run に対応していません")
        return
    store = Store()
    data = store.entries(stats.shift(today, -6))
    recorded = any(r["date"] == today for r in data["entries"])
    # 日曜は、この1週間に写真がなければ写真もお願いする (月曜朝のレポートで使う)
    need_photo = dt.date.fromisoformat(today).weekday() == 6 and not data.get("photos")
    if recorded and not need_photo:
        print("今日は記録済みです")
        return
    if need_photo:
        body = "記録と顔写真がまだです。明日の朝のレポートで比べます" if not recorded else \
            "明日の朝のレポートで、前回の写真と比べます"
        push.send(store, "📷 今日は写真の日です", body, "./#photo", tag="remind")
    else:
        push.send(store, "🧴 今日の肌の記録がまだです", "1分で記録しておきましょう", "./#record", tag="remind")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["weekly", "remind"])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--input", help="--dry-run で使うデータ (アプリの「データを書き出す」で保存した JSON)")
    args = parser.parse_args()
    today = dt.datetime.now(JST).date().isoformat()
    (weekly if args.command == "weekly" else remind)(args, today)


if __name__ == "__main__":
    main()
