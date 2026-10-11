"""記録の集計。Claude に数字を計算させないよう、ここで正確に数える。

- week(): 対象週と前週の数字 (レポート上部のタイル用)
- associations(): 「◯◯した日の翌日は、かゆみが出た割合が △% → □%」のような比較
- change_effects(): 「変えたこと」(化粧品・刃の交換など) の前後14日の比較
- product_table(): 使った製品と、複数の製品に入っている成分を要因にした表 (associations に渡す)
"""
import datetime as dt

ACNE_AREAS = {
    "forehead": "額", "glabella": "眉間", "nose": "鼻", "cheek_r": "右頬", "cheek_l": "左頬",
    "mouth": "口まわり", "chin": "あご", "jaw_r": "右フェイスライン", "jaw_l": "左フェイスライン",
    "scalp": "頭皮・生え際", "neck": "首", "chest": "胸", "back": "背中",
}
SKIN = ["とても悪い", "悪い", "ふつう", "良い", "とても良い"]
ITCH = ["なし", "少し", "かゆい", "強い"]
STRESS = ["低い", "やや低い", "ふつう", "やや高い", "高い"]
ALCOHOL = ["なし", "少し", "ふつう", "多い"]
EXERCISE = ["なし", "軽い", "しっかり"]

LAG_LABEL = {0: "当日", 1: "翌日", 2: "2日後"}
MIN_DAYS = 3        # 「した日」「しなかった日」がそれぞれこれ未満の項目は比べない
MIN_DIFF = 0.15     # これ未満の差は誤差として出さない


def shift(date, days):
    return (dt.date.fromisoformat(date) + dt.timedelta(days=days)).isoformat()


def acne_total(e):
    return sum((e.get("acne") or {}).values())


DRY = ("乾燥・つっぱり", "粉ふき")
IRRITATION = ("赤み", "ヒリヒリ")


def has_detail(e, names):
    """肌の「気になること」に names のどれかがあるか。肌の調子が未記録の日は不明 (None)。"""
    if e.get("skin") is None:
        return None
    return any(x in (e.get("skin_detail") or []) for x in names)


# ---------- 要因 (その日にしたこと) ----------

def factors(e):
    """その日の要因を {名前: True/False} で返す。記録していない項目は含めない (不明扱い)。"""
    f = {}
    food = e.get("food") or []
    if food:  # 何も選んでいない日は「食べなかった」ではなく未記録とみなす (「特になし」を選んだ日は除く)
        f.update({f"食べ物: {x}": True for x in food})
    care = e.get("care") or {}
    used = set(care.get("am") or []) | set(care.get("pm") or [])
    if used:
        f.update({f"スキンケア: {x}": True for x in used})
    if e.get("sleep") is not None:
        f["睡眠6時間未満"] = e["sleep"] < 6
        f["睡眠7時間以上"] = e["sleep"] >= 7
    if e.get("stress") is not None:
        f["ストレス高め (やや高い以上)"] = e["stress"] >= 4
    if e.get("alcohol") is not None:
        f["お酒あり"] = e["alcohol"] >= 1
        f["お酒 ふつう以上 (3杯〜)"] = e["alcohol"] >= 2
    if e.get("exercise") is not None:
        f["運動あり"] = e["exercise"] >= 1
        f["汗をかく運動"] = e["exercise"] >= 2
    return f


def factor_table(entries):
    """日付ごとの要因。食べ物・スキンケアは、その日に記録があって選ばなかったものを False にする。"""
    names_food = {n for e in entries.values() for n in factors(e) if n.startswith("食べ物: ")}
    names_care = {n for e in entries.values() for n in factors(e) if n.startswith("スキンケア: ")}
    table = {}
    for d, e in entries.items():
        f = factors(e)
        if e.get("food") or (e.get("none") or {}).get("food"):
            f = {**{n: False for n in names_food}, **f}
        if (e.get("care") or {}).get("am") or (e.get("care") or {}).get("pm"):
            f = {**{n: False for n in names_care}, **f}
        table[d] = f
    return table


# ---------- 結果 (肌の状態) ----------

OUTCOMES = {
    "肌の調子が悪い (悪い以下)": lambda e: None if e.get("skin") is None else e["skin"] <= 2,
    "かゆみ (かゆい以上)": lambda e: None if (e.get("itch") or {}).get("level") is None else e["itch"]["level"] >= 2,
    "新しいニキビ": lambda e: acne_total(e) > 0,
    "乾燥・粉ふき": lambda e: has_detail(e, DRY),
    "テカリ": lambda e: has_detail(e, ("テカリ",)),
    "赤み・ヒリヒリ": lambda e: has_detail(e, IRRITATION),
}


def associations(entries, table=None, top=(15, 10)):
    """要因ごとに「した日」と「しなかった日」で、当日〜2日後に悪化した割合を比べる。

    同じ要因と結果の組み合わせは、差がいちばん大きい日ずれだけを残す。
    table を省略すると記録の項目 (食べ物・睡眠など) を要因にする。
    """
    table = factor_table(entries) if table is None else table
    names = sorted({n for f in table.values() for n in f})
    out = []
    for outcome, fn in OUTCOMES.items():
        for name in names:
            best = None
            for lag in (0, 1, 2):
                with_, without = [], []
                for d, f in table.items():
                    if name not in f:
                        continue
                    target = entries.get(shift(d, lag))
                    if target is None:
                        continue
                    y = fn(target)
                    if y is None:
                        continue
                    (with_ if f[name] else without).append(y)
                if len(with_) < MIN_DAYS or len(without) < MIN_DAYS:
                    continue
                r1, r0 = sum(with_) / len(with_), sum(without) / len(without)
                if best is None or abs(r1 - r0) > abs(best["diff"]):
                    best = {"factor": name, "outcome": outcome, "when": LAG_LABEL[lag],
                            "rate_with": round(r1, 2), "n_with": len(with_),
                            "rate_without": round(r0, 2), "n_without": len(without), "diff": round(r1 - r0, 2)}
            if best and abs(best["diff"]) >= MIN_DIFF:
                out.append(best)
    worse = sorted([a for a in out if a["diff"] > 0], key=lambda a: -a["diff"])[:top[0]]
    better = sorted([a for a in out if a["diff"] < 0], key=lambda a: a["diff"])[:top[1]]
    return {"worse": worse, "better": better}


# ---------- 製品と成分 ----------

def active(p, d):
    return (not p.get("started") or p["started"] <= d) and (not p.get("ended") or p["ended"] >= d)


ALWAYS_USED = {"シャンプー", "コンディショナー", "整髪料", "ボディソープ", "洗濯洗剤", "柔軟剤"}
INTAKE = {"サプリ", "飲み薬"}


def selected_ids(e):
    """記録タブで選んだ製品 (顔に使うもの・飲んだもの) の id。"""
    prods = e.get("products") or {}
    return set(prods.get("am") or []) | set(prods.get("pm") or []) | set(e.get("supplements") or [])


def products_used(e, d, products):
    """その日に使った製品 (名前の集合) と、使ったか分からない製品。

    髪・体・洗濯のものは使用期間中は毎日使ったとみなす。
    顔に使うもの・飲むものは記録タブで選んだ日だけ使ったとみなす。
    スキンケアも製品も1つも記録していない日は、選ぶ製品は不明扱い (記録し忘れと区別できないため)。
    """
    care = e.get("care") or {}
    chosen = selected_ids(e)
    recorded = bool(chosen or care.get("am") or care.get("pm") or (e.get("none") or {}).get("supplements"))
    used, unknown = set(), set()
    for p in products:
        if p["category"] in ALWAYS_USED:
            if active(p, d):
                used.add(p["name"])
        elif p["id"] in chosen:
            used.add(p["name"])
        elif not recorded and active(p, d):
            unknown.add(p["name"])
    return used, unknown


def product_table(entries, products):
    """「製品: ◯◯」と「成分: ◯◯」を要因にした表。

    成分は2つ以上の製品に入っているものだけを使う (1つの製品にしか入っていない成分は、その製品と同じ比較になる)。
    使った日の並びがまったく同じ要因は1つにまとめる。
    """
    ingredients = {p["name"]: set(p.get("ingredients") or []) for p in products}
    count = {}
    for names in ingredients.values():
        for x in names:
            count[x] = count.get(x, 0) + 1
    shared = sorted(x for x, n in count.items() if n >= 2)

    table = {}
    for d, e in entries.items():
        used, unknown = products_used(e, d, products)
        f = {}
        for p in products:
            if p["name"] not in unknown:
                f[f"製品: {p['name']}"] = p["name"] in used
        if not unknown:  # 使った製品がすべて分かる日だけ成分を数える
            on = set().union(*(ingredients[n] for n in used)) if used else set()
            for x in shared:
                f[f"成分: {x}"] = x in on
        table[d] = f

    # 同じ並びの要因をまとめる (例: 製品Aにしか入っていない成分の組み合わせ)
    # 製品を先に、そのうち使用中の製品を先にする (裏返しの要因では、使用中の製品の方を残す)
    ended = {f"製品: {p['name']}": bool(p.get("ended")) for p in products}
    names = sorted({n for f in table.values() for n in f}, key=lambda n: (not n.startswith("製品"), ended.get(n, False), n))
    groups = {}
    for n in names:
        key = tuple(table[d].get(n) for d in sorted(table))
        mirror = tuple(None if v is None else not v for v in key)
        if mirror in groups:  # 製品Aをやめて製品Bに替えた場合など、ちょうど裏返しの要因は片方だけ残す
            continue
        groups.setdefault(key, []).append(n)
    merged = {}
    for members in groups.values():
        label = members[0] if len(members) == 1 else \
            f"{members[0]} (同じ日: {'、'.join(m.split(': ', 1)[1] for m in members[1:4])}{' ほか' if len(members) > 4 else ''})"
        merged[members[0]] = label
    return {d: {merged[n]: v for n, v in f.items() if n in merged} for d, f in table.items()}



# ---------- 週の数字 ----------

def _avg(values):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 1) if values else None


def week(entries, start, end):
    """start〜end (両端を含む) の数字。"""
    days = [e for d, e in entries.items() if start <= d <= end]
    areas, details, types = {}, {}, {}
    for e in days:
        for k, n in (e.get("acne") or {}).items():
            areas[k] = areas.get(k, 0) + n
        for k in e.get("skin_detail") or []:
            details[k] = details.get(k, 0) + 1
        for k in e.get("acne_types") or []:
            types[k] = types.get(k, 0) + 1
    return {
        "days_recorded": len(days),
        "skin_avg": _avg([e.get("skin") for e in days]),
        "itch_days": sum(1 for e in days if ((e.get("itch") or {}).get("level") or 0) >= 1),
        "acne_total": sum(acne_total(e) for e in days),
        "acne_by_area": areas,
        "skin_detail_days": details,
        "acne_type_days": types,
        "sleep_avg": _avg([e.get("sleep") for e in days]),
        "stress_high_days": sum(1 for e in days if (e.get("stress") or 0) >= 4),
        "alcohol_days": sum(1 for e in days if (e.get("alcohol") or 0) >= 1),
        "exercise_days": sum(1 for e in days if (e.get("exercise") or 0) >= 1),
    }


# ---------- 変えたことの前後 ----------

CHANGE_WINDOW = 14
# 定期的な手入れは前後を比べても意味が薄いので、「最後から何日経ったか」だけに使う
ROUTINE = {"ひげ剃りの刃を交換", "枕カバー・シーツを交換"}


def _period_stats(days):
    if not days:
        return None
    itch = [e["itch"]["level"] >= 2 for e in days if (e.get("itch") or {}).get("level") is not None]
    irr = [has_detail(e, IRRITATION) for e in days]
    irr = [x for x in irr if x is not None]
    pct = lambda xs: round(100 * sum(xs) / len(xs)) if xs else None
    return {
        "days": len(days),
        "skin_avg": _avg([e.get("skin") for e in days]),
        "acne_per_day": round(sum(acne_total(e) for e in days) / len(days), 1),
        "itch_pct": pct(itch),
        "irritation_pct": pct(irr),
    }


def change_effects(entries, today, lookback=60):
    """直近 lookback 日の「変えたこと」ごとに、前14日と後14日 (翌日から) の数字を比べる。

    後の記録が3日未満なら after は None (まだ経過観察中)。
    """
    out = []
    for d in sorted(entries):
        if d < shift(today, -lookback):
            continue
        for c in entries[d].get("changes") or []:
            if c["kind"] in ROUTINE:
                continue
            before = [entries[x] for x in (shift(d, -i) for i in range(1, CHANGE_WINDOW + 1)) if x in entries]
            after = [entries[x] for x in (shift(d, i) for i in range(1, CHANGE_WINDOW + 1))
                     if x in entries and x < today]
            out.append({
                "date": d, "kind": c["kind"], "note": c.get("note") or "",
                "before": _period_stats(before) if len(before) >= MIN_DAYS else None,
                "after": _period_stats(after) if len(after) >= MIN_DAYS and len(before) >= MIN_DAYS else None,
            })
    return out


def last_changes(entries, today):
    """変えたことの種類ごとに、最後に記録した日から何日経ったか。"""
    last = {}
    for d in sorted(entries):
        for c in entries[d].get("changes") or []:
            last[c["kind"]] = d
    return {k: (dt.date.fromisoformat(today) - dt.date.fromisoformat(d)).days for k, d in last.items()}


# ---------- Claude に渡す記録の文章 ----------

def describe(date, e):
    parts = []
    if e.get("skin"):
        detail = e.get("skin_detail") or []
        parts.append(f"肌 {SKIN[e['skin'] - 1]}" + (f" ({'・'.join(detail)})" if detail else ""))
    itch = e.get("itch") or {}
    if itch.get("level") is not None:
        s = f"かゆみ {ITCH[itch['level']]}"
        extra = (itch.get("times") or []) + (itch.get("areas") or [])
        parts.append(s + (f" ({'・'.join(extra)})" if extra else ""))
    acne = e.get("acne") or {}
    parts.append("ニキビ " + ("・".join(f"{ACNE_AREAS.get(k, k)}{n}" for k, n in acne.items()) if acne else "なし")
                 + (f" [{'・'.join(e['acne_types'])}]" if acne and e.get("acne_types") else ""))
    for c in e.get("changes") or []:
        parts.append(f"★{c['kind']}" + (f"「{c['note']}」" if c.get("note") else ""))
    care = e.get("care") or {}
    if care.get("am") or care.get("pm"):
        parts.append(f"ケア 朝[{'・'.join(care.get('am') or [])}] 夜[{'・'.join(care.get('pm') or [])}]")
    if e.get("food"):
        parts.append(f"食 {'・'.join(e['food'])}")
    if e.get("sleep") is not None:
        parts.append(f"睡眠 {e['sleep']}h")
    if e.get("stress"):
        parts.append(f"ストレス {STRESS[e['stress'] - 1]}")
    if e.get("alcohol") is not None:
        parts.append(f"お酒 {ALCOHOL[e['alcohol']]}")
    if e.get("exercise") is not None:
        parts.append(f"運動 {EXERCISE[e['exercise']]}")
    if (e.get("memo") or "").strip():
        parts.append(f"メモ「{e['memo'].strip()[:200]}」")
    wd = "月火水木金土日"[dt.date.fromisoformat(date).weekday()]
    return f"- {date}({wd}) " + " / ".join(parts)
