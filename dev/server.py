"""画面確認用のローカルサーバー (本番では使わない)。

web/ を配信し、/api/* を簡易的に再現する。データはメモリ上だけで、止めると消える。
- 合言葉は「dev」
- 記録は dev/sample.py のダミー (直近45日分)
- レポートは out/report-*.json (generator の --dry-run 出力) があれば表示する
- 製品は dev/sample.py のダミー。登録した製品は「調査中」のまま (成分の調査は Actions でしか動かない)

  python dev/server.py   → http://localhost:8788
"""
import datetime as dt
import http.server
import json
import pathlib
import re
import sys
import urllib.parse
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "dev"))
import sample  # noqa: E402

JST = dt.timezone(dt.timedelta(hours=9))
PASSPHRASE = "dev"
SESSION = "skin_session=dev-session"
ITEMS = {
    "care": ["洗顔", "化粧水", "乳液", "保湿クリーム", "日焼け止め", "ひげ剃り", "シャンプー", "薬・塗り薬"],
    "food": ["乳製品", "揚げ物", "甘いもの", "チョコ", "スナック菓子", "辛いもの", "ラーメン・麺", "ファストフード",
             "コーヒー", "野菜多め", "外食・コンビニ"],
}


def today():
    return dt.datetime.now(JST).date().isoformat()


entries = sample.entries(today())
products = {p["id"]: p for p in sample.products(today())}
CATEGORIES = ["洗顔", "クレンジング", "化粧水", "美容液", "乳液", "保湿クリーム", "日焼け止め", "ひげ剃りフォーム",
              "アフターシェーブ", "シャンプー", "コンディショナー", "整髪料", "ボディソープ", "洗濯洗剤", "柔軟剤",
              "薬・塗り薬", "その他"]


def active(p, d):
    return (not p.get("started") or p["started"] <= d) and (not p.get("ended") or p["ended"] >= d)
reports = {}
for f in sorted((ROOT / "out").glob("report-*.json")):
    r = json.loads(f.read_text(encoding="utf-8"))
    reports[r["id"]] = r


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "web"), **kwargs)

    def send_json(self, data, status=200, headers=None):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("content-length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def api(self, method):
        url = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        route = f"{method} {url.path.rstrip('/')}"
        if route == "POST /api/login":
            if self.body().get("passphrase") != PASSPHRASE:
                return self.send_json({"error": "wrong passphrase"}, 401)
            return self.send_json({"ok": True}, headers={"set-cookie": f"{SESSION}; Path=/; HttpOnly; SameSite=Strict"})
        if route == "POST /api/logout":
            return self.send_json({"ok": True}, headers={"set-cookie": "skin_session=; Path=/; Max-Age=0"})
        if SESSION not in (self.headers.get("cookie") or ""):
            return self.send_json({"error": "login required"}, 401)

        t = today()
        if route == "GET /api/state":
            d = q.get("date", t)
            before = [k for k in entries if k < d]
            p = max(before) if before else None
            last = {}
            for k in sorted(before, reverse=True):
                for c in entries[k].get("changes") or []:
                    last.setdefault(c["kind"], k)
            return self.send_json({"today": t, "date": d, "entry": entries.get(d),
                                   "prev": {"date": p, "entry": entries[p]} if p else None,
                                   "last_changes": last,
                                   "products": [{k: x[k] for k in ("id", "name", "category", "care_item")}
                                                for x in products.values() if active(x, d)],
                                   "items": ITEMS, "vapidPublicKey": None})
        if route == "PUT /api/entry":
            b = self.body()
            entries[b["date"]] = b["entry"]
            return self.send_json({"ok": True})
        if route == "GET /api/history":
            return self.send_json({"today": t, "entries": [{"date": d, "entry": e}
                                                          for d, e in sorted(entries.items(), reverse=True)]})
        if route == "GET /api/products":
            return self.send_json({"products": sorted(products.values(), key=lambda x: x.get("started") or "",
                                                      reverse=True), "categories": CATEGORIES})
        if route == "POST /api/products":
            b = self.body()
            pid = str(uuid.uuid4())
            if b.get("replace") and b.get("started"):
                prev_day = (dt.date.fromisoformat(b["started"]) - dt.timedelta(days=1)).isoformat()
                for x in products.values():
                    if x["category"] == b["category"] and not x["ended"]:
                        x["ended"] = prev_day
            products[pid] = {"id": pid, "name": b["name"], "category": b["category"], "care_item": b.get("care_item") or None,
                             "started": b.get("started"), "ended": None, "status": "pending", "mode": "search",
                             "ingredients_text": "", "ingredients": [], "flags": [], "summary": "", "matched_name": "",
                             "sources": [], "note": "", "updated_at": ""}
            return self.send_json({"ok": True, "product": products[pid]})
        m = re.match(r"^/api/products/([\w-]+)$", url.path)
        if m and m[1] in products:
            x = products[m[1]]
            if method == "DELETE":
                del products[m[1]]
                return self.send_json({"ok": True})
            b = self.body()
            for k in ("ended", "care_item", "started"):
                if k in b:
                    x[k] = b[k] or None
            if b.get("name"):
                x.update(name=b["name"], status="pending", mode="search")
            if "ingredients_text" in b:
                x.update(ingredients_text=b["ingredients_text"], status="pending", mode="manual")
            if b.get("research"):
                x.update(status="pending", mode="search")
            return self.send_json({"ok": True, "product": x})
        if route == "GET /api/reports":
            ids = sorted(reports, reverse=True)
            rid = q.get("id") or (ids[0] if ids else None)
            return self.send_json({"list": [{"id": i, "created_at": reports[i]["created_at"]} for i in ids],
                                   "report": reports.get(rid)})
        if route == "PUT /api/items":
            ITEMS.update(self.body()["items"])
            return self.send_json({"ok": True})
        if route == "GET /api/export":
            return self.send_json({"items": ITEMS, "entries": [{"date": d, "entry": e} for d, e in sorted(entries.items())],
                                   "reports": list(reports.values()), "products": list(products.values())})
        return self.send_json({"error": "not found"}, 404)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
        return super().do_GET()

    def do_POST(self):
        return self.api("POST")

    def do_PUT(self):
        return self.api("PUT")

    def do_DELETE(self):
        return self.api("DELETE")

    def log_message(self, fmt, *args):
        if not re.search(r'" (200|304) ', fmt % args):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    print(f"{len(entries)} entries, {len(reports)} reports. http://localhost:8788 (合言葉: {PASSPHRASE})")
    http.server.ThreadingHTTPServer(("127.0.0.1", 8788), Handler).serve_forever()
