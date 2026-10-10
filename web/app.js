const $ = (sel) => document.querySelector(sel);
const main = $("#main");
const TABS = ["record", "history", "report", "products", "settings"];
const WEEKDAYS = "日月火水木金土";

// ---------- 記録の項目 ----------

const SKIN = ["最悪", "悪い", "ふつう", "良い", "最高"]; // 1〜5
const SKIN_DETAIL = ["乾燥・つっぱり", "粉ふき", "テカリ", "赤み", "ヒリヒリ"];
const ACNE_TYPES = ["白・黒（詰まり）", "赤く腫れている", "膿がある"];
// たまに起きる「変えたこと」。レポートで前後の比較に使う
const CHANGES = ["スキンケア用品を変えた", "シャンプー・洗剤を変えた", "ひげ剃りの刃を交換", "枕カバー・シーツを交換", "皮膚科・薬"];
const CHANGE_HINT = {
  "スキンケア用品を変えた": "例: 化粧水を〇〇に", "シャンプー・洗剤を変えた": "例: 柔軟剤を〇〇に",
  "ひげ剃りの刃を交換": "例: 電気シェーバーに変えた", "枕カバー・シーツを交換": "",
  "皮膚科・薬": "例: 塗り薬〇〇を処方された",
};
const ITCH = ["なし", "少し", "かゆい", "強い"]; // 0〜3
const ITCH_TIMES = ["起床時", "午前", "午後", "夜", "就寝中", "食後", "入浴後", "汗をかいた後", "ひげ剃り後"];
const ITCH_AREAS = ["顔", "首", "頭皮", "体", "腕・手"];
const STRESS = ["低い", "やや低い", "ふつう", "やや高い", "高い"]; // 1〜5
const ALCOHOL = ["なし", "少し", "ふつう", "多い"]; // 0〜3
const ALCOHOL_HINT = ["", "1〜2杯", "3〜4杯", "5杯以上"];
const EXERCISE = ["なし", "軽い", "しっかり"]; // 0〜2
const EXERCISE_HINT = ["", "散歩など", "汗をかく運動"];

// ニキビの場所。顔は鏡で見たときの向き (自分の右頬が画面の右)
const ACNE_AREAS = {
  forehead: "額", glabella: "眉間", nose: "鼻", cheek_r: "右頬", cheek_l: "左頬",
  mouth: "口まわり", chin: "あご", jaw_r: "右フェイスライン", jaw_l: "左フェイスライン",
  scalp: "頭皮・生え際", neck: "首", chest: "胸", back: "背中",
};
const BODY_AREAS = ["scalp", "neck", "chest", "back"];

const emptyEntry = () => ({
  skin: null,
  skin_detail: [],
  itch: { level: null, times: [], areas: [] },
  acne: {},
  acne_types: [],
  care: { am: [], pm: [] },
  food: [],
  sleep: null,
  stress: null,
  alcohol: null,
  exercise: null,
  changes: [], // [{ kind, note }]
  memo: "",
});

// 古い形の記録や欠けた項目を補う
const normalize = (e) => {
  const base = emptyEntry();
  if (!e) return base;
  return { ...base, ...e, itch: { ...base.itch, ...e.itch }, care: { ...base.care, ...e.care }, acne: { ...e.acne } };
};

const acneTotal = (e) => Object.values(e?.acne || {}).reduce((s, n) => s + n, 0);

// ---------- 状態 ----------

let tab = null;
let today = null;
let date = null; // 記録タブで表示している日付
let entry = null;
let prev = null; // 直前の記録 (コピー用)
let lastChanges = {}; // 変えたことの種類ごとの、表示中の日より前で最後の日付
let photo = null; // 表示中の日の顔写真 { date, uploaded_at }
let prevPhoto = null; // それより前で最後の顔写真 (構図をそろえる見本)
let photoBusy = false;
let usedProducts = []; // 表示中の日に使っていた製品 (スキンケア欄に表示)
let items = null; // { care: [], food: [] }
let vapidPublicKey = null;
let reportCache = null;
let reportId = null;

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

const shiftDate = (d, days) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

function dateLabel(d, withYear = false) {
  const [y, m, dd] = d.split("-").map(Number);
  const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  return `${withYear ? `${y}年` : ""}${m}月${dd}日（${w}）`;
}

const md = (d) => d.slice(5).split("-").map(Number).join("/"); // 2026-10-04 → 10/4

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

class LoginRequired extends Error {}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, body === undefined
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 401 && path !== "/api/login") throw new LoginRequired();
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

function emptyHtml(title, sub = "") {
  return `<p class="empty"><strong>${esc(title)}</strong>${esc(sub)}</p>`;
}

// ---------- 合言葉 ----------

function renderLogin(message = "") {
  $("#tabs").hidden = true;
  setHeader("肌ログ");
  main.innerHTML = `<form class="login" id="login">
    <p class="login-lead">合言葉を入力してください</p>
    <input type="password" id="pass" autocomplete="current-password" placeholder="合言葉" required>
    <button class="btn" type="submit">開く</button>
    <p class="login-msg" id="login-msg">${esc(message)}</p>
  </form>`;
  $("#login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await api("/api/login", { method: "POST", body: { passphrase: $("#pass").value } });
      start();
    } catch {
      $("#login-msg").textContent = "合言葉が違います";
      btn.disabled = false;
    }
  });
}

// ---------- ヘッダー ----------

function setHeader(title, { dayNav = false } = {}) {
  $("#title").textContent = title;
  $("#prev-day").hidden = !dayNav;
  $("#next-day").hidden = !dayNav;
  $("#next-day").disabled = !dayNav || date >= today;
  $("#save-status").textContent = "";
}

function setSaveStatus(text, cls = "") {
  const el = $("#save-status");
  el.textContent = text;
  el.className = `save-status ${cls}`;
}

// ---------- 記録タブ ----------

function seg(name, labels, value, { offset = 0, hints = [] } = {}) {
  return `<div class="seg" data-field="${name}">${labels.map((l, i) => {
    const v = i + offset;
    return `<button class="${value === v ? "on" : ""}" data-v="${v}">${esc(l)}${hints[i] ? `<small>${esc(hints[i])}</small>` : ""}</button>`;
  }).join("")}</div>`;
}

function chips(group, list, selected, { add = false } = {}) {
  return `<div class="chips" data-group="${group}">${list.map((l) =>
    `<button class="chip ${selected.includes(l) ? "on" : ""}" data-v="${esc(l)}">${esc(l)}</button>`).join("")}
    ${add ? `<button class="chip add" data-add="${group}">＋ 追加</button>` : ""}</div>`;
}

function faceSvg(acne) {
  const area = (id, shape) => {
    const n = acne[id] || 0;
    return `<g class="area ${n ? "on" : ""}" data-area="${id}" role="button" aria-label="${ACNE_AREAS[id]} ${n}個">${shape}</g>`;
  };
  const badge = (id, x, y) => (acne[id] ? `<text class="count" x="${x}" y="${y}">${acne[id]}</text>` : "");
  const label = (id, x, y) => `<text class="lbl" x="${x}" y="${y}">${ACNE_AREAS[id].replace("フェイスライン", "ライン")}</text>`;
  return `<svg class="face" viewBox="0 0 240 270" aria-label="顔の図">
    <path class="outline" d="M120 18 C 62 18 36 62 36 118 C 36 182 70 236 120 246 C 170 236 204 182 204 118 C 204 62 178 18 120 18 Z"/>
    <path class="ear" d="M36 110 C 22 106 20 140 34 146"/><path class="ear" d="M204 110 C 218 106 220 140 206 146"/>
    ${area("forehead", `<path d="M66 70 C 74 40 100 30 120 30 C 140 30 166 40 174 70 C 154 78 86 78 66 70 Z"/>`)}
    ${area("glabella", `<ellipse cx="120" cy="94" rx="12" ry="10"/>`)}
    ${area("nose", `<path d="M108 108 L132 108 L138 150 C 130 158 110 158 102 150 Z"/>`)}
    ${area("cheek_l", `<ellipse cx="72" cy="146" rx="24" ry="26"/>`)}
    ${area("cheek_r", `<ellipse cx="168" cy="146" rx="24" ry="26"/>`)}
    ${area("mouth", `<ellipse cx="120" cy="184" rx="30" ry="14"/>`)}
    ${area("chin", `<ellipse cx="120" cy="222" rx="26" ry="13"/>`)}
    ${area("jaw_l", `<path d="M48 168 C 56 200 72 222 90 234 L 96 222 C 80 210 66 192 60 166 Z"/>`)}
    ${area("jaw_r", `<path d="M192 168 C 184 200 168 222 150 234 L 144 222 C 160 210 174 192 180 166 Z"/>`)}
    <path class="deco" d="M76 104 q 14 -8 28 0 M136 104 q 14 -8 28 0"/>
    <path class="deco" d="M82 116 q 10 6 20 0 M138 116 q 10 6 20 0"/>
    ${label("forehead", 120, 58)}${label("glabella", 120, 98)}${label("nose", 120, 138)}
    ${label("cheek_l", 72, 150)}${label("cheek_r", 168, 150)}${label("mouth", 120, 188)}
    ${label("chin", 120, 226)}${label("jaw_l", 62, 214)}${label("jaw_r", 178, 214)}
    ${badge("forehead", 158, 52)}${badge("glabella", 136, 86)}${badge("nose", 140, 116)}
    ${badge("cheek_l", 92, 126)}${badge("cheek_r", 188, 126)}${badge("mouth", 152, 176)}
    ${badge("chin", 148, 214)}${badge("jaw_l", 50, 228)}${badge("jaw_r", 190, 228)}
  </svg>`;
}

function card(title, body, { note = "", cls = "" } = {}) {
  return `<section class="card ${cls}"><h2>${esc(title)}${note ? `<span class="note">${note}</span>` : ""}</h2>${body}</section>`;
}

function renderRecord() {
  setHeader(date === today ? `今日・${dateLabel(date)}` : dateLabel(date), { dayNav: true });
  const e = entry;
  const acneN = acneTotal(e);
  const itchOpen = (e.itch.level ?? 0) > 0;
  const canCopy = prev && (prev.entry.care?.am?.length || prev.entry.care?.pm?.length);

  main.innerHTML = `<div class="record">
    ${card("肌の調子", `${seg("skin", SKIN, e.skin, { offset: 1 })}
      <p class="sub">気になること</p>${chips("skin_detail", SKIN_DETAIL, e.skin_detail)}`, { cls: "skin-card" })}

    ${card("かゆみ", `${seg("itch.level", ITCH, e.itch.level)}
      ${itchOpen ? `<p class="sub">いつ？</p>${chips("itch.times", ITCH_TIMES, e.itch.times)}
        <p class="sub">どこ？</p>${chips("itch.areas", ITCH_AREAS, e.itch.areas)}` : ""}`)}

    ${card("新しいニキビ", `${faceSvg(e.acne)}
      <div class="chips body-areas">${BODY_AREAS.map((id) => {
        const n = e.acne[id] || 0;
        return `<button class="chip ${n ? "on" : ""}" data-area="${id}">${ACNE_AREAS[id]}${n ? ` <b>${n}</b>` : ""}</button>`;
      }).join("")}</div>
      <p class="hint">タップで1個ずつ増え、3の次は0に戻ります。鏡で見たときの向きです。</p>
      ${acneN ? `<p class="sub">どんなニキビ？</p>${chips("acne_types", ACNE_TYPES, e.acne_types)}` : ""}`,
      { note: acneN ? `${acneN}個` : "なし" })}

    ${card("スキンケア", `<p class="sub">朝</p>${chips("care.am", items.care, e.care.am, { add: true })}
      <p class="sub">夜</p>${chips("care.pm", items.care, e.care.pm, { add: true })}
      ${canCopy ? `<button class="link-btn" id="copy-care">前回（${esc(dateLabel(prev.date))}）と同じにする</button>` : ""}
      ${usedProducts.length ? `<p class="hint">使っている製品: ${usedProducts.map((x) =>
        `${esc(x.name)}${x.care_item ? `（${esc(x.care_item)}）` : ""}`).join(" · ")}</p>`
        : `<p class="hint">化粧品タブで製品を登録すると、成分まで分析できます。</p>`}`)}

    ${changesCard(e)}

    ${card("食べたもの", `${chips("food", items.food, e.food, { add: true })}
      <p class="hint">肌に関係しそうなものだけで大丈夫です。</p>`)}

    ${card("睡眠", `<div class="stepper" data-field="sleep">
        <button data-step="-0.5" aria-label="30分減らす">−</button>
        <output>${e.sleep == null ? "–" : `${e.sleep}<small>時間</small>`}</output>
        <button data-step="0.5" aria-label="30分増やす">＋</button>
      </div>`)}

    ${card("ストレス", seg("stress", STRESS, e.stress, { offset: 1 }))}
    ${card("お酒", seg("alcohol", ALCOHOL, e.alcohol, { hints: ALCOHOL_HINT }))}
    ${card("運動", seg("exercise", EXERCISE, e.exercise, { hints: EXERCISE_HINT }))}

    ${card("メモ", `<textarea id="memo" rows="3" placeholder="気づいたこと（新しい化粧品、外出先、体調など）">${esc(e.memo)}</textarea>`)}

    ${photoCard()}
  </div>`;
}

// ---------- 顔写真 ----------

const photoUrl = (p) => `/api/photo?date=${p.date}&v=${encodeURIComponent(p.uploaded_at)}`;
const isSunday = (d) => new Date(d + "T00:00:00Z").getUTCDay() === 0;

function photoCard() {
  const note = photo ? "撮影済み" : isSunday(date) ? "今日は写真の日" : "週1回（日曜）でOK";
  const body = photo
    ? `<img class="photo" src="${photoUrl(photo)}" alt="${esc(dateLabel(date))}の顔写真">
      <div class="photo-actions">
        <label class="btn ghost">撮り直す<input type="file" accept="image/*" capture="user" data-photo hidden></label>
        <button class="btn ghost danger" id="photo-delete">削除</button>
      </div>`
    : `<div class="photo-guide">
        ${prevPhoto ? `<figure><img src="${photoUrl(prevPhoto)}" alt="前回の顔写真"><figcaption>前回 ${esc(dateLabel(prevPhoto.date))}<br>この構図にそろえる</figcaption></figure>` : ""}
        <ul>
          <li>正面を向き、腕を伸ばした距離で</li>
          <li>いつも同じ場所・同じ明るさ（昼の窓際など）</li>
          <li>前髪を上げ、あごまで入れる</li>
        </ul>
      </div>
      <label class="btn ${photoBusy ? "disabled" : ""}">${photoBusy ? "送信中…" : "撮影する"}<input type="file" accept="image/*" capture="user" data-photo hidden ${photoBusy ? "disabled" : ""}></label>`;
  return `<section class="card" id="photo-card"><h2>顔写真<span class="note">${note}</span></h2>${body}
    <p class="hint">週次レポートで、前回の写真と比べて見た目の変化を Claude が説明します。写真は合言葉で守られ、設定からいつでも全部消せます。</p></section>`;
}

// 端末で縮小して JPEG にしてから送る (長辺 1280px、300KB 前後)
async function shrink(file, max = 1280) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を変換できませんでした"))), "image/jpeg", 0.85));
}

async function uploadPhoto(file) {
  const d = date;
  photoBusy = true;
  renderRecord();
  try {
    const blob = await shrink(file);
    const res = await fetch(`/api/photo?date=${d}`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: blob });
    if (res.status === 401) throw new LoginRequired();
    if (!res.ok) throw new Error(`${res.status}`);
    if (d === date) photo = (await res.json()).photo;
    setSaveStatus("写真を保存しました ✓", "ok");
  } catch (err) {
    photoBusy = false;
    if (err instanceof LoginRequired) return renderLogin("もう一度合言葉を入力してください");
    alert("写真を保存できませんでした: " + err.message);
  }
  photoBusy = false;
  if (tab === "record" && d === date) renderRecord();
}

main.addEventListener("change", (e) => {
  if (tab === "record" && e.target.matches("[data-photo]") && e.target.files[0]) uploadPhoto(e.target.files[0]);
});

function changesCard(e) {
  const on = (k) => e.changes.find((c) => c.kind === k);
  const notes = e.changes.map((c) => `<label class="change-note"><span>${esc(c.kind)}</span>
    <input type="text" data-note="${esc(c.kind)}" value="${esc(c.note)}" maxlength="60"
      placeholder="${esc(CHANGE_HINT[c.kind] || "内容（なくても可）")}"></label>`).join("");
  const last = CHANGES.filter((k) => lastChanges[k] && !on(k))
    .map((k) => `${k.replace(/を(変えた|交換)$/, "")} ${daysBetween(lastChanges[k], date)}日前`);
  return card("変えたこと・あったこと", `<div class="chips" data-changes>${CHANGES.map((k) =>
      `<button class="chip ${on(k) ? "on" : ""}" data-change="${esc(k)}">${esc(k)}</button>`).join("")}</div>
    ${notes}
    <p class="hint">${last.length ? `前回: ${last.map(esc).join(" · ")}` : "変えた日だけ押してください。レポートで前後を比べます。"}</p>`);
}

// 値を変えたら少し待ってから保存する (連続でタップしても1回で済む)
let saveTimer = null;
let saveDate = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveDate = date;
  setSaveStatus("保存中…");
  saveTimer = setTimeout(save, 600);
}

async function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const d = saveDate;
  try {
    await api("/api/entry", { method: "PUT", body: { date: d, entry } });
    if (tab === "record" && d === date) setSaveStatus("保存しました ✓", "ok");
    reportCache = null;
  } catch (err) {
    if (err instanceof LoginRequired) return renderLogin("もう一度合言葉を入力してください");
    setSaveStatus("保存できませんでした", "err");
  }
}

async function flushSave() {
  if (saveTimer) await save();
}

function setField(path, value) {
  const keys = path.split(".");
  let obj = entry;
  for (const k of keys.slice(0, -1)) obj = obj[k];
  obj[keys.at(-1)] = value;
}

function getField(path) {
  return path.split(".").reduce((o, k) => o?.[k], entry);
}

function toggleIn(list, v) {
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
  else list.push(v);
}

async function addItem(group) {
  const kind = group.startsWith("care") ? "care" : "food";
  const name = (prompt(kind === "care" ? "追加するスキンケア（例: ビタミンC美容液）" : "追加する食べ物（例: 牛乳）") || "").trim();
  if (!name) return;
  if (name.length > 30) return alert("30文字以内で入力してください");
  if (!items[kind].includes(name)) {
    items[kind].push(name);
    api("/api/items", { method: "PUT", body: { items } }).catch(() => {});
  }
  const list = getField(group);
  if (!list.includes(name)) list.push(name);
  renderRecord();
  scheduleSave();
}

function onRecordClick(e) {
  const t = e.target;
  if (t.id === "photo-delete") {
    if (!confirm("この日の写真を削除しますか？")) return;
    const d = date;
    return guard(api(`/api/photo?date=${d}`, { method: "DELETE" }).then(() => {
      if (d === date) photo = null;
      if (tab === "record") renderRecord();
    }));
  }
  const area = t.closest("[data-area]");
  if (area) {
    const id = area.dataset.area;
    const n = ((entry.acne[id] || 0) + 1) % 4;
    if (n) entry.acne[id] = n;
    else delete entry.acne[id];
    if (!acneTotal(entry)) entry.acne_types = [];
    renderRecord();
    return scheduleSave();
  }
  const segBtn = t.closest(".seg button");
  if (segBtn) {
    const field = segBtn.parentElement.dataset.field;
    const v = Number(segBtn.dataset.v);
    setField(field, getField(field) === v ? null : v); // もう一度押すと未入力に戻す
    if (field === "itch.level" && !(entry.itch.level > 0)) {
      entry.itch.times = [];
      entry.itch.areas = [];
    }
    renderRecord();
    return scheduleSave();
  }
  const change = t.closest("[data-change]");
  if (change) {
    const k = change.dataset.change;
    const i = entry.changes.findIndex((c) => c.kind === k);
    if (i >= 0) entry.changes.splice(i, 1);
    else entry.changes.push({ kind: k, note: "" });
    renderRecord();
    return scheduleSave();
  }
  const add = t.closest("[data-add]");
  if (add) return addItem(add.dataset.add);
  const chip = t.closest(".chips[data-group] .chip");
  if (chip) {
    toggleIn(getField(chip.parentElement.dataset.group), chip.dataset.v);
    chip.classList.toggle("on");
    return scheduleSave();
  }
  const step = t.closest("[data-step]");
  if (step) {
    const cur = entry.sleep ?? 6.5; // 最初のタップで 6〜7時間から始める
    entry.sleep = Math.min(14, Math.max(0, cur + Number(step.dataset.step)));
    renderRecord();
    return scheduleSave();
  }
  if (t.id === "copy-care") {
    entry.care = { am: [...(prev.entry.care?.am || [])], pm: [...(prev.entry.care?.pm || [])] };
    renderRecord();
    return scheduleSave();
  }
}

main.addEventListener("click", (e) => {
  if (tab === "record" && entry) onRecordClick(e);
});
main.addEventListener("input", (e) => {
  if (tab !== "record") return;
  if (e.target.id === "memo") {
    entry.memo = e.target.value.slice(0, 2000);
    scheduleSave();
  }
  const note = e.target.dataset.note;
  if (note) {
    const c = entry.changes.find((x) => x.kind === note);
    if (c) c.note = e.target.value.slice(0, 60);
    scheduleSave();
  }
});

// d を省略すると今日
async function loadDay(d) {
  await flushSave();
  main.innerHTML = `<p class="empty">読み込み中…</p>`;
  const s = await api(d ? `/api/state?date=${d}` : "/api/state");
  today = s.today;
  date = s.date;
  items = s.items;
  vapidPublicKey = s.vapidPublicKey;
  prev = s.prev;
  lastChanges = s.last_changes || {};
  photo = s.photo;
  usedProducts = s.products || [];
  prevPhoto = s.prev_photo;
  entry = normalize(s.entry);
  if (tab === "record") renderRecord();
}

$("#prev-day").addEventListener("click", () => guard(loadDay(shiftDate(date, -1))));
$("#next-day").addEventListener("click", () => {
  if (date < today) guard(loadDay(shiftDate(date, 1)));
});

// ---------- 履歴タブ ----------

const SKIN_CLASS = ["", "s1", "s2", "s3", "s4", "s5"];

async function renderHistory() {
  setHeader("履歴");
  main.innerHTML = `<p class="empty">読み込み中…</p>`;
  const h = await api("/api/history?days=60");
  if (tab !== "history") return;
  const byDate = Object.fromEntries(h.entries.map((r) => [r.date, normalize(r.entry)]));
  const photoDays = new Set(h.photos || []);
  const days = [];
  for (let i = 0; i < 60; i++) days.push(shiftDate(h.today, -i));

  // 直近30日の肌の調子 (左が古い)
  const last30 = days.slice(0, 30).reverse();
  const bars = last30.map((d, i) => {
    const s = byDate[d]?.skin;
    const x = i * 10 + 1;
    if (!s) return `<rect class="bar none" x="${x}" y="58" width="8" height="2" rx="1"/>`;
    const hgt = s * 11;
    return `<rect class="bar ${SKIN_CLASS[s]}" x="${x}" y="${60 - hgt}" width="8" height="${hgt}" rx="2"><title>${dateLabel(d)} ${SKIN[s - 1]}</title></rect>`;
  }).join("");
  const recorded = days.slice(0, 30).filter((d) => byDate[d]).length;

  const rows = days.map((d) => {
    const e = byDate[d];
    if (!e) return `<button class="hrow missing" data-date="${d}"><span class="d">${dateLabel(d)}</span><span class="t">未記録</span></button>`;
    const tags = [];
    if (e.itch.level > 0) tags.push(`かゆみ${["", "少し", "中", "強"][e.itch.level]}`);
    const n = acneTotal(e);
    if (n) tags.push(`ニキビ ${n}`);
    if (e.sleep != null) tags.push(`睡眠 ${e.sleep}h`);
    if (e.alcohol > 0) tags.push(`お酒 ${ALCOHOL[e.alcohol]}`);
    if (e.stress >= 4) tags.push(`ストレス ${STRESS[e.stress - 1]}`);
    if (e.skin_detail.length) tags.unshift(e.skin_detail.join("・"));
    for (const c of e.changes) tags.unshift(`◆${c.kind}`);
    if (photoDays.has(d)) tags.unshift("📷");
    return `<button class="hrow" data-date="${d}">
      <span class="d">${dateLabel(d)}</span>
      <span class="score ${SKIN_CLASS[e.skin] || "none"}">${e.skin ? SKIN[e.skin - 1] : "–"}</span>
      <span class="t">${tags.map(esc).join(" · ")}</span></button>`;
  }).join("");

  main.innerHTML = `<section class="card">
      <h2>肌の調子（30日）<span class="note">記録 ${recorded}日</span></h2>
      <svg class="chart" viewBox="0 0 300 62" preserveAspectRatio="none" role="img" aria-label="直近30日の肌の調子">${bars}</svg>
      <div class="chart-axis"><span>${dateLabel(last30[0])}</span><span>今日</span></div>
    </section>
    <div class="hlist">${rows}</div>`;
}

main.addEventListener("click", (e) => {
  if (tab !== "history") return;
  const row = e.target.closest(".hrow");
  if (!row) return;
  tab = "record";
  history.replaceState(null, "", "#record");
  updateTabs();
  guard(loadDay(row.dataset.date).then(() => window.scrollTo(0, 0)));
});

// ---------- レポートタブ ----------

const CONF = { high: "可能性 高め", mid: "可能性 中", low: "可能性 低め" };

function diffText(now, before, unit = "") {
  if (now == null) return "–";
  if (before == null) return `${now}${unit}`;
  const d = Math.round((now - before) * 10) / 10;
  return `${now}${unit}<small>${d > 0 ? `前週より +${d}` : d < 0 ? `前週より ${d}` : "前週と同じ"}</small>`;
}

function reportHtml(r) {
  const w = r.week;
  const ai = r.ai;
  const tiles = [
    ["記録した日", `${w.days_recorded}<small>/ 7日</small>`],
    ["肌の調子（平均）", diffText(w.skin_avg, w.skin_avg_prev)],
    ["かゆみがあった日", `${w.itch_days}<small>日</small>`],
    ["新しいニキビ", diffText(w.acne_total, w.acne_total_prev, "個")],
  ];
  const list = (arr, fn) => (arr?.length ? `<ul class="rlist">${arr.map(fn).join("")}</ul>` : `<p class="muted">特になし</p>`);
  const areas = Object.entries(w.acne_by_area || {}).sort((a, b) => b[1] - a[1]);
  const counts = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)} ${n}日`).join(" · ");
  const fmt = (v, unit = "") => (v == null ? "–" : `${v}${unit}`);
  const effects = (r.changes || []).map((c) => `<li><div class="rhead"><b>${esc(c.kind)}</b>
      <span class="note">${esc(dateLabel(c.date))}</span></div>
      ${c.note ? `<p>${esc(c.note)}</p>` : ""}
      ${c.after ? `<table class="ba"><caption>前後14日（記録 ${c.before.days}日 / ${c.after.days}日）</caption>
        <tr><th></th><th>変える前</th><th>変えた後</th></tr>
        <tr><td>肌の調子</td><td>${fmt(c.before.skin_avg)}</td><td>${fmt(c.after.skin_avg)}</td></tr>
        <tr><td>ニキビ/日</td><td>${fmt(c.before.acne_per_day, "個")}</td><td>${fmt(c.after.acne_per_day, "個")}</td></tr>
        <tr><td>かゆい日</td><td>${fmt(c.before.itch_pct, "%")}</td><td>${fmt(c.after.itch_pct, "%")}</td></tr>
        <tr><td>赤み・ヒリヒリ</td><td>${fmt(c.before.irritation_pct, "%")}</td><td>${fmt(c.after.irritation_pct, "%")}</td></tr></table>`
        : `<p>まだ記録が少ないので経過を見ています</p>`}</li>`).join("");
  return `<div class="report">
    <p class="period">${esc(dateLabel(r.period.from))} 〜 ${esc(dateLabel(r.period.to))}</p>
    <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
    ${areas.length ? `<p class="areas">ニキビの場所: ${areas.map(([a, n]) => `${esc(ACNE_AREAS[a] || a)} ${n}`).join(" · ")}</p>` : ""}
    ${counts(w.acne_type_days) ? `<p class="areas">ニキビの種類: ${counts(w.acne_type_days)}</p>` : ""}
    ${counts(w.skin_detail_days) ? `<p class="areas">肌の状態: ${counts(w.skin_detail_days)}</p>` : ""}

    ${card("今週のまとめ", `<p>${esc(ai.summary)}</p>`)}
    ${r.photos?.this && ai.photo_note ? card("写真から分かること", `<p>${esc(ai.photo_note)}</p>`,
      { note: r.photos.prev ? `${md(r.photos.prev)}と${md(r.photos.this)}を比較` : `${md(r.photos.this)}撮影` }) : ""}
    ${ai.see_doctor ? `<section class="card warn"><h2>皮膚科の受診をおすすめします</h2><p>${esc(ai.see_doctor)}</p></section>` : ""}
    ${card("悪化の原因の候補", list(ai.suspects, (s) => `<li><div class="rhead"><b>${esc(s.factor)}</b>
      <span class="conf ${esc(s.confidence)}">${CONF[s.confidence] || ""}</span></div><p>${esc(s.evidence)}</p></li>`))}
    ${effects ? card("変えたことの前後", `<ul class="rlist">${effects}</ul>`) : ""}
    ${ai.ingredient_findings?.length ? card("成分から考えられること", `<ul class="rlist">${ai.ingredient_findings.map((f) =>
      `<li><b>${esc(f.finding)}</b><p>${esc(f.reason)}</p></li>`).join("")}</ul>`) : ""}
    ${card("良さそうなこと", list(ai.good, (s) => `<li><b>${esc(s.factor)}</b><p>${esc(s.evidence)}</p></li>`))}
    ${card("おすすめアクション", list(ai.actions, (a) => `<li><b>${esc(a.action)}</b><p>${esc(a.reason)}</p></li>`))}
    ${ai.experiment?.action ? card("来週ためすこと", `<p class="exp">${esc(ai.experiment.action)}</p>
      <p class="muted">${esc(ai.experiment.how_to_check)}</p>`, { cls: "exp-card" }) : ""}
    <p class="disclaimer">記録 ${r.data_days}日分の傾向から Claude が考えた仮説です。診断ではありません。
      症状が強い・長引くときは皮膚科を受診してください。</p>
  </div>`;
}

async function renderReport() {
  setHeader("週次レポート");
  if (!reportCache || reportCache.id !== reportId) {
    main.innerHTML = `<p class="empty">読み込み中…</p>`;
    const res = await api(reportId ? `/api/reports?id=${reportId}` : "/api/reports");
    reportCache = { id: reportId, ...res };
  }
  if (tab !== "report") return;
  const { list, report } = reportCache;
  if (!report) {
    main.innerHTML = emptyHtml("レポートはまだありません", "毎週月曜の朝、前の週の記録から作成します（3日以上の記録が必要です）");
    return;
  }
  const picker = list.length > 1 ? `<select id="report-pick" class="picker">${list.map((r) =>
    `<option value="${esc(r.id)}" ${r.id === report.id ? "selected" : ""}>${esc(dateLabel(r.id, true))} のレポート</option>`).join("")}</select>` : "";
  main.innerHTML = picker + reportHtml(report);
  $("#report-pick")?.addEventListener("change", (e) => {
    reportId = e.target.value;
    guard(renderReport());
  });
}

// ---------- 設定タブ ----------

function b64ToBytes(b64) {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function pushStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? "on" : Notification.permission === "denied" ? "denied" : "off";
}

async function enablePush() {
  const reg = await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return renderSettings();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidPublicKey) });
  await api("/api/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
  renderSettings();
}

function itemEditor(kind, title) {
  return `<section><h2>${title}のボタン</h2>
    <div class="chips edit" data-kind="${kind}">${items[kind].map((l) =>
      `<button class="chip" data-del="${esc(l)}">${esc(l)} <span aria-label="削除">✕</span></button>`).join("")}
      <button class="chip add" data-add-item="${kind}">＋ 追加</button></div></section>`;
}

async function renderSettings() {
  setHeader("設定");
  main.innerHTML = `<div class="settings">
    <section><h2>通知</h2><p id="push-msg">確認中…</p><div id="push-action"></div></section>
    ${itemEditor("care", "スキンケア")}
    ${itemEditor("food", "食べたもの")}
    <section><h2>データ</h2>
      <p>記録とレポートをすべて JSON ファイルで保存します（バックアップ用）。</p>
      <a class="btn ghost" href="/api/export" download>データを書き出す</a></section>
    <section><h2>顔写真</h2>
      <p>保存した写真をすべて削除します。記録とレポートの文章は残ります。</p>
      <button class="btn ghost danger" id="delete-photos">写真をすべて削除</button></section>
    <section><h2>この端末</h2><button class="btn ghost" id="logout">ログアウト</button></section>
  </div>`;
  const status = await pushStatus();
  if (tab !== "settings") return;
  const msg = $("#push-msg");
  const action = $("#push-action");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (status === "on") msg.textContent = "オン：週次レポートと、記録し忘れた日の夜（21時半）にお知らせします。";
  else if (status === "unsupported" || !standalone)
    msg.textContent = "Safari の共有ボタン →「ホーム画面に追加」で追加したアプリから通知をオンにできます。";
  else if (status === "denied") msg.textContent = "通知が拒否されています。iPhone の設定 → 通知 から許可してください。";
  else if (!vapidPublicKey) msg.textContent = "サーバー側の通知設定 (VAPID_PUBLIC_KEY) がまだです。";
  else {
    msg.textContent = "週次レポートが届いたときと、記録し忘れた日の夜にお知らせします。";
    action.innerHTML = `<button class="btn" id="push-on">通知をオンにする</button>`;
    $("#push-on").addEventListener("click", (e) => {
      e.target.disabled = true;
      enablePush().catch((err) => {
        msg.textContent = "通知の登録に失敗しました：" + err.message;
        e.target.disabled = false;
      });
    });
  }
}

main.addEventListener("click", async (e) => {
  if (tab !== "settings") return;
  const del = e.target.closest("[data-del]");
  const add = e.target.closest("[data-add-item]");
  if (del) {
    const kind = del.parentElement.dataset.kind;
    if (!confirm(`「${del.dataset.del}」のボタンを消しますか？（過去の記録は残ります）`)) return;
    items[kind] = items[kind].filter((l) => l !== del.dataset.del);
  } else if (add) {
    const kind = add.dataset.addItem;
    const name = (prompt("追加する項目") || "").trim();
    if (!name || items[kind].includes(name)) return;
    if (name.length > 30) return alert("30文字以内で入力してください");
    items[kind].push(name);
  } else if (e.target.id === "delete-photos") {
    if (!confirm("写真をすべて削除します。元に戻せません。よろしいですか？")) return;
    const r = await api("/api/photos", { method: "DELETE" }).catch(() => null);
    reportCache = null;
    return alert(r ? `${r.deleted}枚の写真を削除しました` : "削除できませんでした");
  } else if (e.target.id === "logout") {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    return renderLogin();
  } else return;
  renderSettings();
  guard(api("/api/items", { method: "PUT", body: { items } }));
});

// ---------- タブ ----------

function updateTabs() {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b.dataset.tab === tab);
}

async function selectTab(name) {
  await flushSave();
  tab = name;
  history.replaceState(null, "", "#" + name);
  updateTabs();
  window.scrollTo(0, 0);
  if (name === "record") {
    if (date !== today) return loadDay();
    return renderRecord();
  }
  if (name === "history") return renderHistory();
  if (name === "report") return renderReport();
  if (name === "products") {
    products = null; // 調査の結果が出ているかもしれないので毎回取り直す
    return showProducts();
  }
  return renderSettings();
}

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) guard(selectTab(b.dataset.tab));
});

// 通信エラーやログイン切れをまとめて扱う
function guard(promise) {
  return promise.catch((err) => {
    if (err instanceof LoginRequired) return renderLogin();
    console.error(err);
    main.innerHTML = emptyHtml("読み込めませんでした", "電波の良い所でもう一度開いてください");
  });
}

// ---------- 起動 ----------

async function start() {
  const fromHash = location.hash.slice(1);
  tab = TABS.includes(fromHash) ? fromHash : "record";
  await guard((async () => {
    await loadDay();
    $("#tabs").hidden = false;
    updateTabs();
    if (tab !== "record") await selectTab(tab);
    if (fromHash === "photo") $("#photo-card")?.scrollIntoView({ block: "center" }); // 写真の日の通知から
  })());
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

// 日付が変わってから開き直したら今日の記録にする
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSave();
  else if (entry && tab === "record" && date === today) {
    api("/api/state").then((s) => { if (s.today !== today) guard(loadDay()); }).catch(() => {});
  }
});

start();
