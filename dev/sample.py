"""動作確認用のダミー記録 (本番では使わない)。

分析が働くか確かめられるよう、わざと傾向を入れてある:
- 乳製品を食べた翌日〜2日後はニキビ (あご・口まわり) ができやすい
- お酒を飲んだ翌日はかゆくなりやすい
- 睡眠が6時間未満だと肌の調子が下がる
- 18日前に化粧水を変えてから、赤み・ヒリヒリが出やすい
"""
import datetime as dt
import random

FOODS = ["乳製品", "揚げ物", "甘いもの", "チョコ", "スナック菓子", "辛いもの", "ラーメン・麺", "コーヒー", "野菜多め"]


def entries(today, days=45, seed=7):
    rnd = random.Random(seed)
    end = dt.date.fromisoformat(today)
    out, prev = {}, []
    for i in range(days, 0, -1):
        d = end - dt.timedelta(days=i)
        new_toner = i < 18
        recent = prev[-2:]
        if rnd.random() < 0.12:  # 記録し忘れた日
            prev.append({})
            continue
        food = [f for f in FOODS if rnd.random() < 0.3]
        sleep = rnd.choice([5, 5.5, 6, 6.5, 7, 7, 7.5, 8])
        alcohol = rnd.choice([0, 0, 0, 1, 2, 3]) if d.weekday() >= 4 else rnd.choice([0, 0, 0, 0, 1])
        stress = rnd.choice([2, 3, 3, 4, 5]) if d.weekday() < 5 else rnd.choice([1, 2, 3])

        dairy_before = any("乳製品" in p.get("food", []) for p in recent)
        drank_yesterday = bool(prev) and (prev[-1].get("alcohol") or 0) >= 1
        skin = 4 - (1 if sleep < 6 else 0) - (1 if dairy_before and rnd.random() < 0.5 else 0) + rnd.choice([-1, 0, 0, 1])
        acne = {}
        if dairy_before and rnd.random() < 0.7:
            acne[rnd.choice(["chin", "mouth", "jaw_r"])] = rnd.choice([1, 1, 2])
        elif rnd.random() < 0.15:
            acne[rnd.choice(["forehead", "nose", "cheek_l"])] = 1
        itch = 2 + rnd.choice([0, 1]) if drank_yesterday and rnd.random() < 0.7 else rnd.choice([0, 0, 0, 1])
        detail = []
        if new_toner and rnd.random() < 0.5:
            detail += ["赤み", "ヒリヒリ"] if rnd.random() < 0.5 else ["赤み"]
        if rnd.random() < 0.2:
            detail.append(rnd.choice(["乾燥・つっぱり", "テカリ"]))
        changes = []
        if i == 18:
            changes.append({"kind": "スキンケア用品を変えた", "note": "化粧水を新しいものに"})
        if i == 35:
            changes.append({"kind": "ひげ剃りの刃を交換", "note": ""})
        if i % 8 == 3:
            changes.append({"kind": "枕カバー・シーツを交換", "note": ""})
        e = {
            "skin": max(1, min(5, skin - (1 if detail and new_toner else 0))),
            "skin_detail": detail,
            "itch": {"level": itch, "times": ["就寝中"] if itch >= 2 else [], "areas": ["顔", "首"] if itch >= 2 else []},
            "acne": acne,
            "acne_types": [rnd.choice(["白・黒（詰まり）", "赤く腫れている", "赤く腫れている"])] if acne else [],
            "care": {"am": ["洗顔", "化粧水", "ひげ剃り"] + (["日焼け止め"] if rnd.random() < 0.4 else []),
                     "pm": ["洗顔", "化粧水", "乳液"]},
            "food": food,
            "sleep": sleep,
            "stress": stress,
            "alcohol": alcohol,
            "exercise": rnd.choice([0, 0, 1, 2]),
            "changes": changes,
            "memo": rnd.choice(["", "", "", "ひげ剃りのあと少しヒリヒリ", "飲み会", "あごに新しいニキビ"]),
        }
        out[d.isoformat()] = e
        prev.append(e)
    return out


def products(today=None):
    """ダミーの製品 (成分は架空)。entries() と同じく18日前に化粧水を替えたことにしてある。"""
    end = dt.date.fromisoformat(today) if today else dt.date.today()
    changed = (end - dt.timedelta(days=18)).isoformat()
    before = (end - dt.timedelta(days=19)).isoformat()
    base = {"status": "done", "mode": "search", "ingredients_text": "", "sources": ["https://example.com/"],
            "note": "", "created_at": "", "checked_at": "", "updated_at": "", "ended": None}
    return [
        {**base, "id": "p1", "name": "サンプル化粧水A (しっとり)", "category": "化粧水", "care_item": "化粧水",
         "started": None, "ended": before, "matched_name": "サンプル化粧水A (しっとり)",
         "ingredients": ["水", "グリセリン", "BG", "ヒアルロン酸Na", "フェノキシエタノール"],
         "flags": [], "summary": "（サンプル）保湿成分中心の、刺激になりやすい成分が少ない化粧水です。"},
        {**base, "id": "p2", "name": "サンプル化粧水B (さっぱり)", "category": "化粧水", "care_item": "化粧水",
         "started": changed, "matched_name": "サンプル化粧水B (さっぱり)",
         "ingredients": ["水", "エタノール", "グリセリン", "BG", "メントール", "香料", "フェノキシエタノール"],
         "flags": [{"ingredient": "エタノール", "type": "刺激", "reason": "成分表の前の方にあり、しみることがある"},
                   {"ingredient": "メントール", "type": "刺激", "reason": "清涼感の成分で、ヒリヒリしやすい"},
                   {"ingredient": "香料", "type": "かぶれ", "reason": "人によってかぶれの原因になる"}],
         "summary": "（サンプル）アルコールとメントールが入った、さっぱりタイプの化粧水です。"},
        {**base, "id": "p3", "name": "サンプル洗顔フォーム", "category": "洗顔", "care_item": "洗顔",
         "started": None, "matched_name": "サンプル洗顔フォーム",
         "ingredients": ["水", "ミリスチン酸", "グリセリン", "水酸化K", "ラウリン酸", "香料", "BG"],
         "flags": [{"ingredient": "香料", "type": "かぶれ", "reason": "人によってかぶれの原因になる"}],
         "summary": "（サンプル）石けんベースの一般的な洗顔フォームです。"},
        {**base, "id": "p4", "name": "サンプル柔軟剤", "category": "柔軟剤", "care_item": None, "started": None,
         "status": "pending", "ingredients": [], "flags": [], "summary": "", "matched_name": ""},
    ]
