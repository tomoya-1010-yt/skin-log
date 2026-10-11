"""Claude の呼び出し (週次レポートの文章、化粧品の成分の調査)。

Claude Code の CLI (claude -p) を使う。GitHub Actions では CLAUDE_CODE_OAUTH_TOKEN
(claude setup-token で作ったトークン) で認証し、Claude の契約の範囲で動く。
"""
import json
import os
import shutil
import subprocess
import tempfile

import stats

MODEL = os.environ.get("SKIN_MODEL", "opus")
FALLBACK_MODEL = os.environ.get("SKIN_FALLBACK_MODEL", "sonnet")

SYSTEM = ("あなたは皮膚の健康に詳しいアシスタントです。利用者本人の記録と集計結果だけを根拠に、"
          "肌の悪化要因の仮説と、日常生活で試せる対策を日本語で提案します。医師ではないので診断はしません。")


def _tool_result_text(block):
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


def _claude(prompt, schema, effort="high", tools="", max_turns=3, with_tool_texts=False, system=SYSTEM):
    """claude -p を実行し、JSON Schema に沿った結果を返す。

    tools にツール名 (例: "WebSearch,WebFetch") を渡すとそれだけ使わせる。
    with_tool_texts=True なら (結果, ツール結果のテキスト一覧) を返す (検索結果に出た URL か確かめる用)。
    """
    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("claude コマンドが見つかりません。Claude Code をインストールしてください")
    cmd = [
        exe, "-p", "標準入力の指示に従って作業してください。",
        "--output-format", "stream-json", "--verbose",
        "--json-schema", json.dumps(schema, ensure_ascii=False),
        "--model", MODEL, "--fallback-model", FALLBACK_MODEL, "--effort", effort,
        "--system-prompt", system,
        "--tools", tools,
        "--permission-mode", "dontAsk", "--permission-prompts", "none",
        "--max-turns", str(max_turns),
        "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config",
    ]
    if tools:
        cmd += ["--allowedTools", tools]
    # 空のフォルダで動かし、リポジトリの設定やファイルを読ませない
    with tempfile.TemporaryDirectory() as cwd:
        proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True,
                              encoding="utf-8", cwd=cwd, timeout=900)
    result, tool_texts = None, []
    for line in proc.stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "user":
            for block in event.get("message", {}).get("content", []):
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    tool_texts.append(_tool_result_text(block))
        elif event.get("type") == "result":
            result = event
    if result is None:
        raise RuntimeError(f"claude が結果を返しませんでした (exit {proc.returncode}): {proc.stderr[-2000:]}")
    if result.get("is_error"):
        raise RuntimeError(f"claude の実行に失敗しました ({result.get('subtype')}): {result.get('result')}")
    print(f"  claude: {result.get('num_turns')} turns, 参考コスト ${result.get('total_cost_usd', 0):.3f}")
    output = result.get("structured_output")
    if output is None:
        output = json.loads(result.get("result") or "null")
    return (output, tool_texts) if with_tool_texts else output


# ---------- 化粧品・日用品の成分 ----------

FLAG_TYPES = ["刺激", "ニキビ", "かぶれ", "乾燥"]

PRODUCT_SYSTEM = ("あなたは化粧品の成分に詳しいアシスタントです。製品の全成分表示を、実際に確認できた情報だけから"
                  "正確に書き写し、肌トラブルのきっかけになりやすい成分を日本語で説明します。推測で成分を補いません。")

PRODUCT_SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean"},
        "matched_name": {"type": "string"},
        "ingredients": {"type": "array", "items": {"type": "string"}},
        "source_urls": {"type": "array", "items": {"type": "string"}},
        "flags": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "ingredient": {"type": "string"},
                "type": {"type": "string", "enum": FLAG_TYPES},
                "reason": {"type": "string"},
            },
            "required": ["ingredient", "type", "reason"], "additionalProperties": False}},
        "summary": {"type": "string"},
        "note": {"type": "string"},
    },
    "required": ["found", "matched_name", "ingredients", "source_urls", "flags", "summary", "note"],
    "additionalProperties": False,
}

FLAG_RULES = """## 成分チェック (flags と summary)
- flags: 肌トラブルのきっかけになりやすい成分だけを挙げる (多くても8個)。成分名は ingredients の表記そのままにする。
  - 刺激: エタノール (成分表の前の方にあるとき)、香料、メントール、精油・植物エキスの一部、高濃度の酸 (AHA/BHA)、レチノールなど
  - ニキビ: 毛穴を詰まらせやすいとされる油分 (ココナッツ油、ミリスチン酸イソプロピルなど)
  - かぶれ: かぶれ (接触皮膚炎) の原因として知られる成分 (一部の防腐剤、香料成分、染料など)
  - 乾燥: 脱脂力の強い洗浄成分 (ラウリル硫酸Na など)
  - 一般的な保湿成分や、配合量がごく少ないと考えられる成分 (成分表の後ろの方) は、理由がない限り挙げない。
  - reason は「なぜ注意か」を25字以内で。怖がらせる書き方はしない。
- summary: この製品の特徴を1〜2文で (例:「アルコールと香料が入った、さっぱりタイプの化粧水です」)。
  多くの人には問題なく使える成分でも、人によって合わないことがある、という前提で書く。"""


SUPPLEMENT_RULES = """## サプリ・飲み薬の場合
- ingredients には原材料名と栄養成分 (分かれば1日量あたりの含有量も、例:「パントテン酸 500mg」) を書く。
  医薬品は有効成分 (含有量つき) を先に、添加物をあとに書く。
- flags は肌との関係が知られているものだけ (多くても5個):
  - ニキビ: ニキビが悪化することがあると報告されているもの (ヨウ素、高用量のビタミンB12、ホエイプロテインなど)
  - かぶれ: 発疹などの皮膚の副作用が知られているもの (医薬品は添付文書に皮膚の副作用の記載があるもの)
  - 刺激・乾燥: 当てはまるものがあれば (例: 高用量のビタミンAによる乾燥)
- summary には、肌に関係する作用がよく言われているもの (例: パントテン酸と皮脂) があれば、
  根拠の強さ (研究が少ない、など) とあわせて1〜2文で書く。効果を言い切らない。"""


def _rules_for(product):
    return SUPPLEMENT_RULES if product["category"] in stats.INTAKE else ""


def lookup_product(product):
    """商品名から Web で全成分を調べ、成分チェックもする。

    出典 URL は、検索・取得ツールの結果に実際に出てきたものだけを残す。
    """
    prompt = f"""次の製品の「全成分表示」を Web で調べてください。

製品: {product['name']}
種類: {product['category']}

## 調べ方
- WebSearch で「{product['name']} 全成分」などと検索し、WebFetch で成分が載っているページを開いて確かめる。
- 信頼できる順: メーカー公式サイト > 大手通販・ドラッグストアの商品ページ > 化粧品の口コミサイト。
  個人ブログやまとめ記事だけを根拠にしない。
- 同じシリーズの別商品 (しっとり/さっぱり、詰め替え用、旧パッケージ、医薬部外品の有効成分のみの表示など) と
  取り違えないこと。商品名が完全に一致しない場合は matched_name に実際に見つかった商品名を書き、note に違いを書く。
- 2つ以上のページで成分が一致すれば確実。リニューアルで成分が変わっている場合は新しい方を使い、note に書く。

## 出力
- found: 全成分を確認できたときだけ true。見つからない・自信がないときは false にし、ingredients は空、
  note に理由と、利用者がパッケージの成分表示を貼り付けるとよいことを書く。
- ingredients: 全成分表示の順番どおり、表示の名前のまま (日本語)。自分で補ったり推測したりしない。
  医薬部外品で「有効成分」「その他の成分」に分かれている場合は、有効成分を先に並べる。
- source_urls: 成分を確認したページの URL (ツールの結果に出てきたものだけ)。
- matched_name: 見つかった商品の正式な名前。

{FLAG_RULES}

{_rules_for(product)}
"""
    output, tool_texts = _claude(prompt, PRODUCT_SCHEMA, effort="medium", tools="WebSearch,WebFetch",
                                 max_turns=15, with_tool_texts=True, system=PRODUCT_SYSTEM)
    seen = "\n".join(tool_texts)
    output["source_urls"] = [u for u in output["source_urls"]
                             if u.startswith("http") and (not seen or u in seen or u.rstrip("/") in seen)]
    if output["found"] and not output["source_urls"]:
        print("  出典を確認できないので見つからなかった扱いにします")
        output.update(found=False, ingredients=[], flags=[],
                      note=(output["note"] + " 出典のページを確認できませんでした。").strip())
    return output


def check_ingredients(product):
    """利用者が貼り付けた成分表示で、成分チェックだけをする (Web は使わない)。"""
    prompt = f"""次の製品の全成分表示を見て、成分チェックをしてください。

製品: {product['name']}
種類: {product['category']}
全成分 (利用者がパッケージから書き写したもの):
{product['ingredients_text']}

## 出力
- found: true
- matched_name: 製品名をそのまま
- ingredients: 成分を表示の順番どおりに1つずつ分けたもの (誤字は直さず、区切りだけ整える)
- source_urls: 空
- note: 書き写しに明らかな誤りや抜けがありそうなら書く。なければ空文字

{FLAG_RULES}

{_rules_for(product)}
"""
    return _claude(prompt, PRODUCT_SCHEMA, effort="medium", system=PRODUCT_SYSTEM)


REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "suspects": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "factor": {"type": "string"},
                "evidence": {"type": "string"},
                "confidence": {"type": "string", "enum": ["high", "mid", "low"]},
            },
            "required": ["factor", "evidence", "confidence"], "additionalProperties": False}},
        "good": {"type": "array", "items": {
            "type": "object",
            "properties": {"factor": {"type": "string"}, "evidence": {"type": "string"}},
            "required": ["factor", "evidence"], "additionalProperties": False}},
        "actions": {"type": "array", "items": {
            "type": "object",
            "properties": {"action": {"type": "string"}, "reason": {"type": "string"}},
            "required": ["action", "reason"], "additionalProperties": False}},
        "experiment": {
            "type": "object",
            "properties": {"action": {"type": "string"}, "how_to_check": {"type": "string"}},
            "required": ["action", "how_to_check"], "additionalProperties": False},
        "see_doctor": {"type": "string"},
        "ingredient_findings": {"type": "array", "items": {
            "type": "object",
            "properties": {"finding": {"type": "string"}, "reason": {"type": "string"}},
            "required": ["finding", "reason"], "additionalProperties": False}},
    },
    "required": ["summary", "suspects", "good", "actions", "experiment", "see_doctor",
                 "ingredient_findings"],
    "additionalProperties": False,
}


def _assoc_lines(items):
    return "\n".join(
        f"- {a['factor']} → {a['when']}の「{a['outcome']}」: "
        f"した日 {round(a['rate_with'] * 100)}% ({a['n_with']}日) / しなかった日 {round(a['rate_without'] * 100)}% "
        f"({a['n_without']}日)"
        for a in items) or "(差が出た項目なし)"


def _week_lines(w):
    return (f"記録 {w['days_recorded']}日、肌の調子の平均 {w['skin_avg']} (1=とても悪い〜5=とても良い)、"
            f"かゆみがあった日 {w['itch_days']}日、新しいニキビ {w['acne_total']}個、"
            f"睡眠の平均 {w['sleep_avg']}時間、ストレス高めの日 {w['stress_high_days']}日、"
            f"お酒を飲んだ日 {w['alcohol_days']}日、運動した日 {w['exercise_days']}日")


def _counts(obj):
    return "、".join(f"{k} {n}日" for k, n in sorted(obj.items(), key=lambda x: -x[1])) or "なし"


def _change_lines(changes, since):
    def fmt(p):
        return (f"記録{p['days']}日・肌の調子{p['skin_avg']}・ニキビ{p['acne_per_day']}個/日・"
                f"かゆい日{p['itch_pct']}%・赤みヒリヒリ{p['irritation_pct']}%")
    lines = []
    for c in changes:
        head = f"- {c['date']} {c['kind']}" + (f"「{c['note']}」" if c["note"] else "")
        if c["after"]:
            lines.append(f"{head}: 前14日 [{fmt(c['before'])}] → 後14日 [{fmt(c['after'])}]")
        elif c["before"]:
            lines.append(f"{head}: 変えてからの記録がまだ少ない (経過観察中)。前14日 [{fmt(c['before'])}]")
        else:
            lines.append(f"{head}: 前後の記録が少なく比較できない")
    last = "、".join(f"{k} {n}日前" for k, n in since.items()) or "記録なし"
    return ("\n".join(lines) or "(直近60日に記録なし)") + f"\n種類ごとの最後の記録: {last}"


def _product_lines(products):
    if not products:
        return "(登録なし)"
    lines = []
    for p in products:
        if p["category"] in stats.ALWAYS_USED:
            how = f"{p.get('started') or '以前'}〜{p.get('ended') or '使用中'}・期間中は毎日使用"
        else:
            how = f"{'飲んだ' if p['category'] in stats.INTAKE else '使った'}日を記録で選ぶ"
            how += f"・{p['ended']}にやめた" if p.get("ended") else ""
        head = f"- {p['name']} ({p['category']}・{how})"
        if not p.get("ingredients"):
            lines.append(f"{head}: 成分は未確認")
            continue
        flags = "、".join(f"{f['ingredient']}[{f['type']}]" for f in p.get("flags") or []) or "なし"
        lines.append(f"{head}\n  注意成分: {flags}\n  全成分: {'、'.join(p['ingredients'][:60])}")
    return "\n".join(lines)


def report(date, period, this_week, prev_week, assoc, records, data_days, last_report, changes, since,
           products=None, product_assoc=None):
    """products: 登録した製品。product_assoc: 製品・成分ごとの集計。"""
    product_assoc = product_assoc or {"worse": [], "better": []}
    acne_areas = "、".join(f"{stats.ACNE_AREAS.get(k, k)} {n}個"
                          for k, n in sorted(this_week["acne_by_area"].items(), key=lambda x: -x[1])) or "なし"
    last = "(前回のレポートなし)"
    if last_report:
        ai = last_report["ai"]
        last = "\n".join([f"- おすすめアクション: {a['action']}" for a in ai["actions"]]
                         + [f"- 来週ためすこと: {ai['experiment']['action']}"])
    prompt = f"""今日は {date} です。利用者 (成人男性) の肌の記録から、週次レポートを作ってください。

## 対象週 ({period['from']}〜{period['to']})
{_week_lines(this_week)}
ニキビの場所: {acne_areas}
ニキビの種類 (その種類があった日数): {_counts(this_week['acne_type_days'])}
肌の気になること (あった日数): {_counts(this_week['skin_detail_days'])}

## 前週
{_week_lines(prev_week) if prev_week['days_recorded'] else "(記録なし)"}

## 要因と悪化の関係 (直近{data_days}日分の記録から集計済み。数字はこれをそのまま使うこと)
悪化と一緒に起きやすいもの:
{_assoc_lines(assoc['worse'])}

悪化しにくいもの:
{_assoc_lines(assoc['better'])}

## 使っている (使っていた) 化粧品・日用品
{_product_lines(products)}

## 製品・成分と悪化の関係 (集計済み。「成分」は2つ以上の製品に入っているもの)
悪化と一緒に起きやすいもの:
{_assoc_lines(product_assoc['worse'])}

悪化しにくいもの:
{_assoc_lines(product_assoc['better'])}

## 変えたこと・あったこと (前後14日の比較。集計済み)
{_change_lines(changes, since)}

## 直近の記録 (メモも含む。★は変えたこと)
{chr(10).join(records)}

## 前回のレポートで提案したこと
{last}

## 書き方
- summary: 対象週の肌の様子と前週との違いを2〜3文で。前回の提案を実行できたか記録から読み取れれば触れる。
- suspects: 悪化の原因の候補を最大4つ、可能性の高い順に。
  - evidence には集計の数字 (割合と日数) か、記録・メモの具体的な日付を必ず入れる。数字を自分で計算し直したり作ったりしない。
  - confidence: high は「した日」が8日以上あり差が大きく、メモなどとも矛盾しないときだけ。日数が5日未満なら low。
  - 毎日しているスキンケアなど比べられないものは候補にしない。一緒に起きやすいだけで原因とは限らない点を踏まえる。
  - 集計に出ていなくても、メモ (新しい化粧品、ひげ剃り負けなど) に明らかな手がかりがあれば候補にしてよい。
  - 変えたことの後に悪化しているものは候補にする。ただし化粧品などは合うかどうか分かるまで2〜4週間かかることがあり、
    同じ時期にほかの要因 (お酒・睡眠など) も変わっていないか記録で確かめてから書く。
- 肌の「気になること」とニキビの種類に合わせて、対策を具体的にする:
  - 乾燥・粉ふき → 洗いすぎ・熱いお湯・保湿のタイミング (入浴後すぐ) など
  - テカリ → 洗顔の回数や洗い残し、保湿不足による皮脂の増え方など
  - 赤み・ヒリヒリ → 刺激になっているもの (新しい化粧品、アルコール入りの化粧水、ひげ剃り) を減らす方向
  - 白・黒 (詰まり) が中心 → 毛穴の詰まり対策 (洗顔、油分の多い化粧品の見直し)
  - 赤く腫れている・膿がある → 触らない・つぶさない。膿のニキビが続くときや数が多いときは see_doctor へ
- 刃の交換や枕カバーの交換から日数が空いているとき (目安: 刃は2〜4週間、枕カバーは1週間) は、
  あご・フェイスラインや頬のニキビ、ひげ剃り後のかゆみの記録と合わせて actions に入れてよい。
- good: 肌に良さそうな習慣を最大3つ。根拠の書き方は suspects と同じ。なければ空。
- actions: 来週から試せる具体的な行動を2〜4つ。「〜を減らす」より「◯曜までは〜を控えて記録を比べる」のように、
  期間や量が分かる書き方にする。一般によく知られた対策 (保湿、ひげ剃りの刃の交換、枕カバーの交換、日焼け止めなど) を
  加える場合は、記録のどこから必要だと考えたかを reason に書く。処方薬や特定の商品名はすすめない。
- experiment: 原因の候補を1つ確かめるための、来週1週間の小さな実験。how_to_check にはアプリのどの記録を見れば
  効果が分かるかを書く。
- see_doctor: 強いかゆみが何日も続く、ニキビが増え続けている、膿のニキビが何日も続く、
  腫れ・痛み・出血・広い範囲の湿疹がメモにある
  などのときだけ、受診をすすめる理由を1〜2文で。当てはまらなければ空文字。
- ingredient_findings: 製品の成分から考えられることを最大3つ。製品が未登録・成分が未確認なら空。
  - 「変えたことの前後比較」や「製品・成分と悪化の関係」で悪化と重なる製品があれば、その製品の注意成分を挙げて関係を説明する
    (例: 化粧水Bに替えてから赤みが増えた。Bには前の化粧水になかったエタノールと香料が入っている)。
  - 悪化した時期の製品に共通して入っている成分があれば挙げる。
  - 記録の悪化と重ならない注意成分は、「今は問題が出ていない」と短く触れる程度にし、やめるようにはすすめない。
  - 成分が原因かどうかは記録だけでは決められないこと、かぶれが疑われるときは皮膚科のパッチテストで確かめられることを
    必要に応じて reason に書く。
  - 製品が原因の候補になるときは suspects にも入れ、actions では商品名ではなく「エタノール・香料の入っていない化粧水を
    2週間試す」のように成分の条件ですすめる。
  - サプリ・飲み薬も同じように見てよい。ただし飲み薬は医師に処方されている可能性があるので、やめる・減らすようには
    すすめず、気になる場合は処方した医師や薬剤師に相談するよう書く。サプリの効果は言い切らない。
- 記録が少ない場合は、その分だけ断定を避けて短く書く。
- 文体は「です・ます」。1項目は長くても60字程度。専門用語は避ける。
"""
    return _claude(prompt, REPORT_SCHEMA)
