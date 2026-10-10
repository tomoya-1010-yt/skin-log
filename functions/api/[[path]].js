// /api/* をまとめて処理する Cloudflare Pages Functions。
// - アプリ用: /api/login 以外は合言葉でログインしたときの Cookie が必要
// - 分析スクリプト用: /api/internal/* (Authorization: Bearer INGEST_TOKEN が必要)

const DAY = 24 * 60 * 60 * 1000;
const COOKIE = "skin_session";
const COOKIE_MAX_AGE = 400 * 24 * 3600; // ブラウザが許す最長 (約13か月)
const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 端末側で縮小してから送るので通常は 300KB 前後
const photoKey = (date) => `photos/${date}.jpg`;

// 化粧品・日用品の種類。替えたときに記録する「変えたこと」の種類を決める
const PRODUCT_CATEGORIES = ["洗顔", "クレンジング", "化粧水", "美容液", "乳液", "保湿クリーム", "日焼け止め",
  "ひげ剃りフォーム", "アフターシェーブ", "シャンプー", "コンディショナー", "整髪料", "ボディソープ",
  "洗濯洗剤", "柔軟剤", "薬・塗り薬", "その他"];
const changeKindOf = (category) =>
  ["シャンプー", "コンディショナー", "整髪料", "ボディソープ", "洗濯洗剤", "柔軟剤"].includes(category) ? "シャンプー・洗剤を変えた"
    : category === "薬・塗り薬" ? "皮膚科・薬" : "スキンケア用品を変えた";

// ボタンにする項目の初期値。アプリの設定から追加・削除でき、settings テーブルに保存される
const DEFAULT_ITEMS = {
  care: ["洗顔", "化粧水", "乳液", "保湿クリーム", "日焼け止め", "ひげ剃り", "シャンプー", "薬・塗り薬"],
  food: ["乳製品", "揚げ物", "甘いもの", "チョコ", "スナック菓子", "辛いもの", "ラーメン・麺", "ファストフード",
    "コーヒー", "野菜多め", "外食・コンビニ"],
};

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...init.headers },
  });

const jstDate = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const shiftDate = (date, days) => jstDate(Date.parse(date + "T12:00:00+09:00") + days * DAY);

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- 合言葉 ----------

// Cookie に入れる値。合言葉から作るので、合言葉を変えると全端末がログアウトされる
async function sessionToken(env) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(env.APP_PASSPHRASE), { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("skin-log-session-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cookieOf(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

async function loggedIn(env, request) {
  return safeEqual(cookieOf(request, COOKIE) || "", await sessionToken(env));
}

async function login(env, request) {
  const { passphrase } = await request.json().catch(() => ({}));
  if (typeof passphrase !== "string" || !safeEqual(passphrase, env.APP_PASSPHRASE)) {
    await new Promise((r) => setTimeout(r, 1000)); // 総当たりを遅くする
    return json({ error: "wrong passphrase" }, { status: 401 });
  }
  const cookie = `${COOKIE}=${await sessionToken(env)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
  return json({ ok: true }, { headers: { "set-cookie": cookie } });
}

function logout() {
  return json({ ok: true }, { headers: { "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` } });
}

// ---------- アプリ用 ----------

async function items(env) {
  const row = await env.DB.prepare("SELECT body FROM settings WHERE key = 'items'").first();
  return row ? JSON.parse(row.body) : DEFAULT_ITEMS;
}

async function entryOf(env, date) {
  const row = await env.DB.prepare("SELECT body FROM entries WHERE date = ?").bind(date).first();
  return row ? JSON.parse(row.body) : null;
}

async function state(env, url) {
  const today = jstDate();
  const date = url.searchParams.get("date") || today;
  if (!isDate(date)) return json({ error: "bad date" }, { status: 400 });
  const prev = await env.DB.prepare("SELECT date, body FROM entries WHERE date < ? ORDER BY date DESC LIMIT 1")
    .bind(date).first();
  // 「変えたこと」の種類ごとに、この日より前で最後に記録した日
  const last_changes = {};
  const changed = (await env.DB
    .prepare(`SELECT date, body FROM entries WHERE date < ? AND body LIKE '%"changes":[{%' ORDER BY date DESC LIMIT 300`)
    .bind(date).all()).results;
  for (const r of changed)
    for (const c of JSON.parse(r.body).changes || []) last_changes[c.kind] ??= r.date;
  const photo = await env.DB.prepare("SELECT date, uploaded_at FROM photos WHERE date = ?").bind(date).first();
  const prevPhoto = await env.DB.prepare("SELECT date, uploaded_at FROM photos WHERE date < ? ORDER BY date DESC LIMIT 1")
    .bind(date).first();
  // この日に使っていた製品 (記録タブに表示する)
  const products = (await allProducts(env))
    .filter((x) => (!x.started || x.started <= date) && (!x.ended || x.ended >= date))
    .map(({ id, name, category, care_item }) => ({ id, name, category, care_item }));
  return json({
    today, date,
    entry: await entryOf(env, date),
    photo, prev_photo: prevPhoto, products,
    prev: prev ? { date: prev.date, entry: JSON.parse(prev.body) } : null,
    last_changes,
    items: await items(env),
    vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
  });
}

async function putEntry(env, request) {
  const { date, entry } = await request.json();
  if (!isDate(date) || date > jstDate() || typeof entry !== "object" || !entry)
    return json({ error: "bad entry" }, { status: 400 });
  const body = JSON.stringify(entry);
  if (body.length > 20000) return json({ error: "too large" }, { status: 413 });
  await env.DB.prepare("INSERT OR REPLACE INTO entries (date, body, updated_at) VALUES (?, ?, ?)")
    .bind(date, body, new Date().toISOString()).run();
  return json({ ok: true });
}

async function history(env, url) {
  const days = Math.min(Number(url.searchParams.get("days")) || 60, 400);
  const since = jstDate(Date.now() - days * DAY);
  const rows = (await env.DB.prepare("SELECT date, body FROM entries WHERE date >= ? ORDER BY date DESC")
    .bind(since).all()).results;
  const photos = (await env.DB.prepare("SELECT date FROM photos WHERE date >= ?").bind(since).all()).results;
  return json({
    today: jstDate(),
    entries: rows.map((r) => ({ date: r.date, entry: JSON.parse(r.body) })),
    photos: photos.map((r) => r.date),
  });
}

// ---------- 顔写真 ----------

async function getPhoto(env, date) {
  const obj = isDate(date) ? await env.PHOTOS.get(photoKey(date)) : null;
  if (!obj) return json({ error: "not found" }, { status: 404 });
  return new Response(obj.body, {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" },
  });
}

async function putPhoto(env, request, url) {
  const date = url.searchParams.get("date");
  if (!isDate(date) || date > jstDate()) return json({ error: "bad date" }, { status: 400 });
  const body = await request.arrayBuffer();
  const head = new Uint8Array(body.slice(0, 3));
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return json({ error: "jpeg only" }, { status: 400 });
  if (body.byteLength > PHOTO_MAX_BYTES) return json({ error: "too large" }, { status: 413 });
  await env.PHOTOS.put(photoKey(date), body, { httpMetadata: { contentType: "image/jpeg" } });
  const uploaded_at = new Date().toISOString();
  await env.DB.prepare("INSERT OR REPLACE INTO photos (date, uploaded_at, size) VALUES (?, ?, ?)")
    .bind(date, uploaded_at, body.byteLength).run();
  return json({ ok: true, photo: { date, uploaded_at } });
}

async function deletePhoto(env, url) {
  const date = url.searchParams.get("date");
  if (!isDate(date)) return json({ error: "bad date" }, { status: 400 });
  await env.PHOTOS.delete(photoKey(date));
  await env.DB.prepare("DELETE FROM photos WHERE date = ?").bind(date).run();
  return json({ ok: true });
}

async function deleteAllPhotos(env) {
  const dates = (await env.DB.prepare("SELECT date FROM photos").all()).results.map((r) => r.date);
  for (let i = 0; i < dates.length; i += 500) await env.PHOTOS.delete(dates.slice(i, i + 500).map(photoKey));
  await env.DB.prepare("DELETE FROM photos").run();
  return json({ ok: true, deleted: dates.length });
}

async function reports(env, url) {
  const list = (await env.DB.prepare("SELECT id, created_at FROM reports ORDER BY id DESC LIMIT 60").all()).results;
  const id = url.searchParams.get("id") || list[0]?.id;
  const row = id ? await env.DB.prepare("SELECT body FROM reports WHERE id = ?").bind(id).first() : null;
  return json({ list, report: row ? JSON.parse(row.body) : null });
}

async function putItems(env, request) {
  const { items: next } = await request.json();
  const ok = (a) => Array.isArray(a) && a.length <= 60 && a.every((s) => typeof s === "string" && s.length <= 30);
  if (!next || !ok(next.care) || !ok(next.food)) return json({ error: "bad items" }, { status: 400 });
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, body) VALUES ('items', ?)")
    .bind(JSON.stringify({ care: next.care, food: next.food })).run();
  return json({ ok: true });
}

async function subscribe(env, request) {
  const { subscription } = await request.json();
  if (!subscription?.endpoint) return json({ error: "invalid subscription" }, { status: 400 });
  await env.DB
    .prepare("INSERT OR REPLACE INTO push_subs (endpoint, body, created_at) VALUES (?, ?, ?)")
    .bind(subscription.endpoint, JSON.stringify(subscription), new Date().toISOString()).run();
  return json({ ok: true });
}

// ---------- 化粧品・日用品 ----------

async function allProducts(env) {
  const rows = (await env.DB.prepare("SELECT body FROM products").all()).results;
  return rows.map((r) => JSON.parse(r.body)).sort((a, b) => (b.started || "").localeCompare(a.started || ""));
}

async function productOf(env, id) {
  const row = await env.DB.prepare("SELECT body FROM products WHERE id = ?").bind(id).first();
  return row ? JSON.parse(row.body) : null;
}

async function saveProduct(env, p) {
  p.updated_at = new Date().toISOString();
  await env.DB.prepare("INSERT OR REPLACE INTO products (id, status, body, updated_at) VALUES (?, ?, ?, ?)")
    .bind(p.id, p.status, JSON.stringify(p), p.updated_at).run();
}

// その日の記録の「変えたこと」に追記する (記録がなければ作る)
async function addChange(env, date, kind, note) {
  const entry = (await entryOf(env, date)) || {};
  entry.changes = entry.changes || [];
  const same = entry.changes.find((c) => c.kind === kind);
  if (same) same.note = same.note ? `${same.note}、${note}` : note;
  else entry.changes.push({ kind, note });
  await env.DB.prepare("INSERT OR REPLACE INTO entries (date, body, updated_at) VALUES (?, ?, ?)")
    .bind(date, JSON.stringify(entry), new Date().toISOString()).run();
}

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ingredientsFromText = (t) => t.split(/[、,，\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 200);

async function createProduct(env, request) {
  const b = await request.json();
  const name = text(b.name, 80);
  if (!name || !PRODUCT_CATEGORIES.includes(b.category)) return json({ error: "bad product" }, { status: 400 });
  const started = b.started && isDate(b.started) && b.started <= jstDate() ? b.started : null;
  const p = {
    id: crypto.randomUUID(), name, category: b.category, care_item: text(b.care_item, 30) || null,
    started, ended: null, status: "pending", mode: "search",
    ingredients_text: "", ingredients: [], flags: [], summary: "", matched_name: "", sources: [], note: "",
    created_at: new Date().toISOString(), checked_at: null,
  };
  if (started) {
    // 同じ種類で使っていた製品は前日までにする
    const ended = [];
    if (b.replace) {
      for (const x of await allProducts(env)) {
        if (x.category !== p.category || x.ended || (x.started && x.started >= started)) continue;
        x.ended = shiftDate(started, -1);
        await saveProduct(env, x);
        ended.push(x.name);
      }
    }
    await addChange(env, started, changeKindOf(p.category), ended.length ? `${ended.join("・")} → ${name}` : name);
  }
  await saveProduct(env, p);
  return json({ ok: true, product: p });
}

async function updateProduct(env, request, id) {
  const p = await productOf(env, id);
  if (!p) return json({ error: "not found" }, { status: 404 });
  const b = await request.json();
  if ("ended" in b) p.ended = b.ended && isDate(b.ended) ? b.ended : null;
  if ("care_item" in b) p.care_item = text(b.care_item, 30) || null;
  if ("started" in b) p.started = b.started && isDate(b.started) ? b.started : null;
  if (b.name && text(b.name, 80) !== p.name) {
    p.name = text(b.name, 80);
    Object.assign(p, { status: "pending", mode: "search", ingredients_text: "" });
  }
  if (typeof b.ingredients_text === "string") {
    // 成分を貼り付けたときは、調べずにその成分でチェックだけする
    p.ingredients_text = text(b.ingredients_text, 6000);
    Object.assign(p, p.ingredients_text
      ? { status: "pending", mode: "manual", ingredients: ingredientsFromText(p.ingredients_text) }
      : { status: "pending", mode: "search" });
  }
  if (b.research) Object.assign(p, { status: "pending", mode: "search", ingredients_text: "" });
  await saveProduct(env, p);
  return json({ ok: true, product: p });
}

async function deleteProduct(env, id) {
  await env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// 全データの書き出し (バックアップ用)
async function exportAll(env) {
  const entries = (await env.DB.prepare("SELECT date, body FROM entries ORDER BY date").all()).results;
  const reps = (await env.DB.prepare("SELECT id, body FROM reports ORDER BY id").all()).results;
  const photos = (await env.DB.prepare("SELECT date FROM photos ORDER BY date").all()).results;
  return json({
    exported_at: new Date().toISOString(),
    photos: photos.map((r) => r.date), // 画像そのものは含まない
    items: await items(env),
    products: await allProducts(env),
    entries: entries.map((r) => ({ date: r.date, entry: JSON.parse(r.body) })),
    reports: reps.map((r) => JSON.parse(r.body)),
  }, { headers: { "content-disposition": `attachment; filename="skin-log-${jstDate()}.json"` } });
}

// ---------- 分析スクリプト用 ----------

async function internalEntries(env, url) {
  const since = url.searchParams.get("since") || "0000-00-00";
  const rows = (await env.DB.prepare("SELECT date, body FROM entries WHERE date >= ? ORDER BY date")
    .bind(since).all()).results;
  const photos = (await env.DB.prepare("SELECT date FROM photos WHERE date >= ? ORDER BY date").bind(since).all()).results;
  return json({
    today: jstDate(),
    items: await items(env),
    entries: rows.map((r) => ({ date: r.date, entry: JSON.parse(r.body) })),
    photos: photos.map((r) => r.date),
  });
}

async function internalProducts(env, url) {
  const status = url.searchParams.get("status");
  const list = await allProducts(env);
  return json(status ? list.filter((p) => p.status === status) : list);
}

// 成分の調査結果を保存する。利用者が途中で名前などを変えていたら上書きしない
async function putProductResult(env, request, id) {
  const p = await productOf(env, id);
  if (!p) return json({ error: "not found" }, { status: 404 });
  const r = await request.json();
  if (r.updated_at !== p.updated_at) return json({ error: "changed", product: p }, { status: 409 });
  for (const k of ["status", "ingredients", "flags", "summary", "matched_name", "sources", "note", "checked_at"])
    if (k in r) p[k] = r[k];
  await saveProduct(env, p);
  return json({ ok: true });
}

async function internalReports(env) {
  const rows = (await env.DB.prepare("SELECT id, body FROM reports ORDER BY id DESC LIMIT 1").all()).results;
  const ids = (await env.DB.prepare("SELECT id FROM reports").all()).results.map((r) => r.id);
  return json({ ids, latest: rows[0] ? JSON.parse(rows[0].body) : null });
}

async function putReport(env, request) {
  const r = await request.json();
  if (!isDate(r.id)) return json({ error: "bad id" }, { status: 400 });
  await env.DB.prepare("INSERT OR REPLACE INTO reports (id, created_at, body) VALUES (?, ?, ?)")
    .bind(r.id, r.created_at, JSON.stringify(r)).run();
  return json({ ok: true });
}

async function subscriptions(env, request) {
  if (request.method === "DELETE") {
    const { endpoint } = await request.json();
    await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(endpoint).run();
    return json({ ok: true });
  }
  const rows = (await env.DB.prepare("SELECT body FROM push_subs").all()).results;
  return json(rows.map((r) => JSON.parse(r.body)));
}

// ---------- ルーティング ----------

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const route = `${request.method} ${path}`;

  if (path.startsWith("/api/internal/")) {
    const auth = request.headers.get("authorization") || "";
    if (!env.INGEST_TOKEN || !safeEqual(auth, `Bearer ${env.INGEST_TOKEN}`))
      return json({ error: "unauthorized" }, { status: 401 });
    if (route === "GET /api/internal/entries") return internalEntries(env, url);
    if (route === "GET /api/internal/reports") return internalReports(env);
    if (route === "PUT /api/internal/report") return putReport(env, request);
    if (route === "GET /api/internal/photo") return getPhoto(env, url.searchParams.get("date"));
    if (route === "GET /api/internal/products") return internalProducts(env, url);
    const pr = path.match(/^\/api\/internal\/products\/([\w-]+)$/);
    if (pr && request.method === "PUT") return putProductResult(env, request, pr[1]);
    if (path === "/api/internal/subscriptions") return subscriptions(env, request);
    return json({ error: "not found" }, { status: 404 });
  }

  if (!env.APP_PASSPHRASE) return json({ error: "APP_PASSPHRASE is not set" }, { status: 500 });
  if (route === "POST /api/login") return login(env, request);
  if (route === "POST /api/logout") return logout();
  if (!(await loggedIn(env, request))) return json({ error: "login required" }, { status: 401 });

  if (route === "GET /api/state") return state(env, url);
  if (route === "PUT /api/entry") return putEntry(env, request);
  if (route === "GET /api/history") return history(env, url);
  if (route === "GET /api/reports") return reports(env, url);
  if (route === "PUT /api/items") return putItems(env, request);
  if (route === "POST /api/subscribe") return subscribe(env, request);
  if (route === "GET /api/export") return exportAll(env);
  if (route === "GET /api/photo") return getPhoto(env, url.searchParams.get("date"));
  if (route === "PUT /api/photo") return putPhoto(env, request, url);
  if (route === "DELETE /api/photo") return deletePhoto(env, url);
  if (route === "DELETE /api/photos") return deleteAllPhotos(env);
  if (route === "GET /api/products") return json({ products: await allProducts(env), categories: PRODUCT_CATEGORIES });
  if (route === "POST /api/products") return createProduct(env, request);
  const pm = path.match(/^\/api\/products\/([\w-]+)$/);
  if (pm && request.method === "PUT") return updateProduct(env, request, pm[1]);
  if (pm && request.method === "DELETE") return deleteProduct(env, pm[1]);
  return json({ error: "not found" }, { status: 404 });
}
