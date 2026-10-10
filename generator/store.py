"""アプリ側 (Cloudflare Pages Functions) の内部 API クライアント。"""
import os
import sys

import requests


def _env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"{name} が空です。GitHub の Settings → Secrets and variables → Actions に"
                 " 登録されているか確認してください")
    return value


class Store:
    def __init__(self):
        self.base = _env("APP_URL").rstrip("/") + "/api/internal"
        self.headers = {"Authorization": f"Bearer {_env('INGEST_TOKEN')}"}

    def _req(self, method, path, **kwargs):
        res = requests.request(method, self.base + path, headers=self.headers, timeout=30, **kwargs)
        res.raise_for_status()
        return res.json() if res.content else None

    def entries(self, since):
        return self._req("GET", "/entries", params={"since": since})

    def photo(self, date):
        res = requests.get(self.base + "/photo", params={"date": date}, headers=self.headers, timeout=60)
        res.raise_for_status()
        return res.content

    def products(self, status=None):
        return self._req("GET", "/products", params={"status": status} if status else None)

    def put_product_result(self, product_id, result):
        """利用者が調査中に製品を書き換えていたら False を返す (結果は捨てる)。"""
        res = requests.put(f"{self.base}/products/{product_id}", json=result, headers=self.headers, timeout=30)
        if res.status_code in (404, 409):
            return False
        res.raise_for_status()
        return True

    def reports(self):
        return self._req("GET", "/reports")

    def put_report(self, report):
        return self._req("PUT", "/report", json=report)

    def subscriptions(self):
        return self._req("GET", "/subscriptions")

    def delete_subscription(self, endpoint):
        return self._req("DELETE", "/subscriptions", json={"endpoint": endpoint})
