"""画面確認用のローカルサーバー (本番では使わない)。

web/ を配信し、/api/* を簡易的に再現する。データはメモリ上だけで、止めると消える。
- 合言葉は「dev」
- 記録は dev/sample.py のダミー (直近45日分)
- レポートは out/report-*.json (generator の --dry-run 出力) があれば表示する

  python dev/server.py   → http://localhost:8788
"""
import datetime as dt
import http.server
import json
import pathlib
import re
import sys
import urllib.parse

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
photos = {}  # date -> (uploaded_at, bytes)
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

    def send_bytes(self, data, ctype):
        self.send_response(200)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def raw_body(self):
        return self.rfile.read(int(self.headers.get("content-length") or 0))

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
            ph = lambda k: {"date": k, "uploaded_at": photos[k][0]}
            prev_ph = max((k for k in photos if k < d), default=None)
            return self.send_json({"today": t, "date": d, "entry": entries.get(d),
                                   "photo": ph(d) if d in photos else None,
                                   "prev_photo": ph(prev_ph) if prev_ph else None,
                                   "prev": {"date": p, "entry": entries[p]} if p else None,
                                   "last_changes": last,
                                   "items": ITEMS, "vapidPublicKey": None})
        if route == "PUT /api/entry":
            b = self.body()
            entries[b["date"]] = b["entry"]
            return self.send_json({"ok": True})
        if route == "GET /api/history":
            return self.send_json({"today": t, "entries": [{"date": d, "entry": e}
                                                          for d, e in sorted(entries.items(), reverse=True)],
                                   "photos": sorted(photos)})
        if route == "GET /api/photo":
            if q.get("date") not in photos:
                return self.send_json({"error": "not found"}, 404)
            return self.send_bytes(photos[q["date"]][1], "image/jpeg")
        if route == "PUT /api/photo":
            data = self.raw_body()
            if data[:3] != b"\xff\xd8\xff":
                return self.send_json({"error": "jpeg only"}, 400)
            photos[q["date"]] = (dt.datetime.now(JST).isoformat(), data)
            return self.send_json({"ok": True, "photo": {"date": q["date"], "uploaded_at": photos[q["date"]][0]}})
        if route == "DELETE /api/photo":
            photos.pop(q.get("date"), None)
            return self.send_json({"ok": True})
        if route == "DELETE /api/photos":
            n = len(photos)
            photos.clear()
            return self.send_json({"ok": True, "deleted": n})
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
                                   "reports": list(reports.values())})
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
