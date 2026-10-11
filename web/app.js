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

// 登録した製品の数え方。顔に使うもの・飲むものは記録タブで使った日に選び、髪・体・洗濯は使用期間中は毎日使ったとみなす
const ALWAYS_USED = ["シャンプー", "コンディショナー", "整髪料", "ボディソープ", "洗濯洗剤", "柔軟剤"];
const INTAKE = ["サプリ", "飲み薬"];
const productKind = (p) => (ALWAYS_USED.includes(p.category) ? "always" : INTAKE.includes(p.category) ? "intake" : "face");
// 製品の種類と、スキンケアの種類ボタンの対応。製品を登録した種類のボタンは製品のボタンに置き換える
const CARE_ITEM_FOR = { ひげ剃りフォーム: "ひげ剃り", クレンジング: "洗顔", 保湿クリーム: "保湿クリーム", 塗り薬: "薬・塗り薬" };

const emptyEntry = () => ({
  skin: null,
  skin_detail: [],
  itch: { level: null, times: [], areas: [] },
  acne: {},
  acne_types: [],
  care: { am: [], pm: [] },
  products: { am: [], pm: [] }, // 使った製品の id (顔に使うもの)
  supplements: [], // 飲んだサプリ・薬の id
  food: [],
  sleep: null,
  stress: null,
  alcohol: null,
  exercise: null,
  changes: [], // [{ kind, note }]
  none: {}, // 「なし」を選んだ項目 { acne, food, supplements } (未入力と区別するため)
  memo: "",
});

// 古い形の記録や欠けた項目を補う
const normalize = (e) => {
  const base = emptyEntry();
  if (!e) return base;
  return { ...base, ...e, itch: { ...base.itch, ...e.itch }, care: { ...base.care, ...e.care },
    products: { ...base.products, ...e.products }, acne: { ...e.acne }, none: { ...e.none } };
};

const acneTotal = (e) => Object.values(e?.acne || {}).reduce((s, n) => s + n, 0);

// ---------- 状態 ----------

let tab = null;
let today = null;
let date = null; // 記録タブで表示している日付
let entry = null;
let prev = null; // 直前の記録 (コピー用)
let lastChanges = {}; // 変えたことの種類ごとの、表示中の日より前で最後の日付
let allProducts = []; // 登録した製品 (記録タブのボタン用。id, name, category, started, ended)
let collapsed = new Set(); // 記録タブでたたんでいるカード
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
    <input type="password" id="pass" autocomplete="current-password" autocapitalize="off" autocorrect="off"
      spellcheck="false" placeholder="合言葉" required>
    <label class="show-pass"><input type="checkbox" id="show-pass"> 合言葉を表示する</label>
    <button class="btn" type="submit">開く</button>
    <p class="login-msg" id="login-msg">${esc(message)}</p>
  </form>`;
  $("#show-pass").addEventListener("change", (e) => { $("#pass").type = e.target.checked ? "text" : "password"; });
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

// 記録タブのカード。入力済みなら見出しに ✓ を付け、たたんでいるときは1行の要約だけ出す
function rcard(key, title, body, { done = false, summary = "", cls = "", note = "" } = {}) {
  const closed = collapsed.has(key);
  return `<section class="card rcard ${cls} ${closed ? "closed" : ""}" id="card-${key}">
    <h2><button class="rhead-btn" data-toggle="${key}" aria-expanded="${!closed}">
      <span class="check ${done ? "on" : ""}" aria-hidden="true">${done ? "✓" : ""}</span>
      <span class="ttl">${esc(title)}</span>
      ${closed ? `<span class="sum">${esc(summary)}</span>` : note ? `<span class="note">${note}</span>` : ""}
      <span class="chev" aria-hidden="true"></span></button></h2>
    ${closed ? "" : body}</section>`;
}

const noneChip = (key, on, label = "今日はなし") =>
  `<button class="chip none-chip ${on ? "on" : ""}" data-none="${key}">${label}</button>`;
const nameOf = (id) => allProducts.find((p) => p.id === id)?.name || "（削除した製品）";
const shortList = (names, max = 3) => (names.length > max ? `${names.slice(0, max).join("・")} ほか${names.length - max}` : names.join("・"));

// 入力済みかどうかと、たたんだときの要約 (進み具合と折りたたみに使う)
function recordStatus(e, hasIntake) {
  const acneN = acneTotal(e);
  const careNames = [...new Set([...e.products.am, ...e.products.pm].map(nameOf).concat(e.care.am, e.care.pm))];
  const areas = Object.entries(e.acne).map(([k, n]) => `${ACNE_AREAS[k]}${n}`);
  const list = [
    ["skin", "肌の調子", e.skin != null, e.skin ? [SKIN[e.skin - 1], ...e.skin_detail].join(" · ") : ""],
    ["itch", "かゆみ", e.itch.level != null,
      e.itch.level == null ? "" : [ITCH[e.itch.level], ...e.itch.times].join(" · ")],
    ["acne", "ニキビ", acneN > 0 || !!e.none.acne, acneN ? [shortList(areas), ...e.acne_types].join(" · ") : "なし"],
    ["care", "スキンケア", careNames.length > 0, shortList(careNames)],
    ...(hasIntake ? [["intake", "飲んだもの", e.supplements.length > 0 || !!e.none.supplements,
      e.supplements.length ? shortList(e.supplements.map(nameOf)) : "なし"]] : []),
    ["food", "食べたもの", e.food.length > 0 || !!e.none.food, e.food.length ? shortList(e.food) : "特になし"],
    ["sleep", "睡眠", e.sleep != null, e.sleep == null ? "" : `${e.sleep}時間`],
    ["stress", "ストレス", e.stress != null, e.stress ? STRESS[e.stress - 1] : ""],
    ["alcohol", "お酒", e.alcohol != null, e.alcohol == null ? "" : ALCOHOL[e.alcohol]],
    ["exercise", "運動", e.exercise != null, e.exercise == null ? "" : EXERCISE[e.exercise]],
  ];
  return Object.fromEntries(list.map(([key, label, done, summary]) => [key, { label, done, summary }]));
}

// 日付を開いたときに、入力済みのカードと「変えたこと」をたたむ (入力中のカードは開いたままにする)
function initCollapsed() {
  const st = recordStatus(entry, productsFor(entry).intake.length > 0);
  collapsed = new Set(Object.keys(st).filter((k) => st[k].done));
  collapsed.add("changes");
}

// その日に使える製品 (使用期間中のもの + その日にすでに選んでいたもの)
function productsFor(e) {
  const chosen = new Set([...e.products.am, ...e.products.pm, ...e.supplements]);
  const shown = allProducts.filter((p) => chosen.has(p.id) ||
    ((!p.started || p.started <= date) && (!p.ended || p.ended >= date)));
  return {
    face: shown.filter((p) => productKind(p) === "face"),
    intake: shown.filter((p) => productKind(p) === "intake"),
    always: shown.filter((p) => productKind(p) === "always" && !p.ended),
  };
}

function renderRecord() {
  setHeader(date === today ? `今日・${dateLabel(date)}` : dateLabel(date), { dayNav: true });
  const e = entry;
  const acneN = acneTotal(e);
  const itchOpen = (e.itch.level ?? 0) > 0;
  const pe = prev && normalize(prev.entry);
  const canCopy = pe && [pe.care.am, pe.care.pm, pe.products.am, pe.products.pm, pe.supplements].some((x) => x.length);
  const { face, intake, always } = productsFor(e);
  const covered = new Set(face.map((p) => (items.care.includes(p.category) ? p.category : CARE_ITEM_FOR[p.category])));
  const careFor = (sel) => items.care.filter((c) => !covered.has(c) || sel.includes(c));
  const st = recordStatus(e, intake.length > 0);
  const keys = Object.keys(st);
  const doneN = keys.filter((k) => st[k].done).length;
  const left = keys.filter((k) => !st[k].done);
  const routineDone = st.care.done && (!st.intake || st.intake.done);
  const copyNames = pe ? [...new Set([...pe.products.am, ...pe.products.pm, ...pe.supplements].map(nameOf)
    .concat(pe.care.am, pe.care.pm))] : [];
  const r = (key, title, body, opts = {}) => rcard(key, title, body, { done: st[key].done, summary: st[key].summary, ...opts });

  main.innerHTML = `<div class="record">
    <section class="card progress-card ${left.length ? "" : "complete"}">
      <div class="progress-head"><b>${left.length ? `${doneN} / ${keys.length} 入力済み` : "✓ 全部入力しました"}</b>
        ${left.length ? "" : `<span class="note">おつかれさまです</span>`}</div>
      <div class="bar"><div style="width:${(doneN / keys.length) * 100}%"></div></div>
      ${canCopy && !routineDone ? `<button class="btn block routine" data-copy>いつものケアとサプリを入れる
        <small>前回（${esc(dateLabel(prev.date))}）と同じ: ${esc(shortList(copyNames, 4))}</small></button>` : ""}
      ${left.length ? `<p class="left">残り: ${left.map((k) => `<button class="jump" data-jump="${k}">${esc(st[k].label)}</button>`).join("")}</p>` : ""}
    </section>

    ${r("skin", "肌の調子", `${seg("skin", SKIN, e.skin, { offset: 1 })}
      <p class="sub">気になること</p>${chips("skin_detail", SKIN_DETAIL, e.skin_detail)}`, { cls: "skin-card" })}

    ${r("itch", "かゆみ", `${seg("itch.level", ITCH, e.itch.level)}
      ${itchOpen ? `<p class="sub">いつ？</p>${chips("itch.times", ITCH_TIMES, e.itch.times)}
        <p class="sub">どこ？</p>${chips("itch.areas", ITCH_AREAS, e.itch.areas)}` : ""}`)}

    ${r("acne", "新しいニキビ", `${faceSvg(e.acne)}
      <div class="chips body-areas">${BODY_AREAS.map((id) => {
        const n = e.acne[id] || 0;
        return `<button class="chip ${n ? "on" : ""}" data-area="${id}">${ACNE_AREAS[id]}${n ? ` <b>${n}</b>` : ""}</button>`;
      }).join("")}${noneChip("acne", !!e.none.acne)}</div>
      <p class="hint">タップで1個ずつ増え、3の次は0に戻ります。鏡で見たときの向きです。</p>
      ${acneN ? `<p class="sub">どんなニキビ？</p>${chips("acne_types", ACNE_TYPES, e.acne_types)}` : ""}`,
      { note: acneN ? `${acneN}個` : "" })}

    ${r("care", "スキンケア", `<p class="sub">朝</p>${productChips("products.am", face, e.products.am)}${chips("care.am", careFor(e.care.am), e.care.am, { add: true })}
      <p class="sub">夜</p>${productChips("products.pm", face, e.products.pm)}${chips("care.pm", careFor(e.care.pm), e.care.pm, { add: true })}
      ${canCopy ? `<button class="link-btn" data-copy>前回（${esc(dateLabel(prev.date))}）と同じにする</button>` : ""}
      <p class="hint">${face.length ? "◆ は化粧品タブで登録した製品です。" : "化粧品タブで製品を登録すると、製品ごとのボタンが出て成分まで分析できます。"}
        ${always.length ? `毎日使っているもの: ${always.map((p) => esc(p.name)).join(" · ")}` : ""}</p>`)}

    ${intake.length ? r("intake", "飲んだもの（サプリ・薬）",
      `${productChips("supplements", intake, e.supplements)}<div class="chips">${noneChip("supplements", !!e.none.supplements, "飲んでいない")}</div>`)
      : card("飲んだもの（サプリ・薬）", `<p class="hint">化粧品タブで種類を「サプリ」「飲み薬」にして登録すると、ここにボタンが出ます。</p>`)}

    ${r("food", "食べたもの", `${chips("food", items.food, e.food, { add: true })}
      <div class="chips">${noneChip("food", !!e.none.food, "特になし")}</div>
      <p class="hint">肌に関係しそうなものだけで大丈夫です。</p>`)}

    ${r("sleep", "睡眠", `<div class="stepper" data-field="sleep">
        <button data-step="-0.5" aria-label="30分減らす">−</button>
        <output>${e.sleep == null ? "–" : `${e.sleep}<small>時間</small>`}</output>
        <button data-step="0.5" aria-label="30分増やす">＋</button>
      </div>`)}

    ${r("stress", "ストレス", seg("stress", STRESS, e.stress, { offset: 1 }))}
    ${r("alcohol", "お酒", seg("alcohol", ALCOHOL, e.alcohol, { hints: ALCOHOL_HINT }))}
    ${r("exercise", "運動", seg("exercise", EXERCISE, e.exercise, { hints: EXERCISE_HINT }))}

    ${changesCard(e)}

    ${card("メモ", `<textarea id="memo" rows="3" placeholder="気づいたこと（新しい化粧品、外出先、体調など）">${esc(e.memo)}</textarea>`)}
  </div>`;
}

// 登録した製品のボタン (値は製品の id)
function productChips(group, list, selected) {
  if (!list.length) return "";
  return `<div class="chips product-chips" data-group="${group}">${list.map((p) =>
    `<button class="chip ${selected.includes(p.id) ? "on" : ""}" data-v="${esc(p.id)}">${esc(p.name)}</button>`).join("")}</div>`;
}

function changesCard(e) {
  const on = (k) => e.changes.find((c) => c.kind === k);
  const notes = e.changes.map((c) => `<label class="change-note"><span>${esc(c.kind)}</span>
    <input type="text" data-note="${esc(c.kind)}" value="${esc(c.note)}" maxlength="60"
      placeholder="${esc(CHANGE_HINT[c.kind] || "内容（なくても可）")}"></label>`).join("");
  const last = CHANGES.filter((k) => lastChanges[k] && !on(k))
    .map((k) => `${k.replace(/を(変えた|交換)$/, "")} ${daysBetween(lastChanges[k], date)}日前`);
  return rcard("changes", "変えたこと・あったこと", `<div class="chips" data-changes>${CHANGES.map((k) =>
      `<button class="chip ${on(k) ? "on" : ""}" data-change="${esc(k)}">${esc(k)}</button>`).join("")}</div>
    ${notes}
    <p class="hint">${last.length ? `前回: ${last.map(esc).join(" · ")}` : "変えた日だけ押してください。レポートで前後を比べます。"}</p>`,
    { done: e.changes.length > 0, summary: e.changes.length ? e.changes.map((c) => c.kind).join("・") : "なし（変えた日だけ記録）" });
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
  const toggle = t.closest("[data-toggle]");
  if (toggle) {
    const k = toggle.dataset.toggle;
    if (collapsed.has(k)) collapsed.delete(k);
    else collapsed.add(k);
    return renderRecord();
  }
  const jump = t.closest("[data-jump]");
  if (jump) {
    collapsed.delete(jump.dataset.jump);
    renderRecord();
    return $(`#card-${jump.dataset.jump}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const none = t.closest("[data-none]");
  if (none) {
    const k = none.dataset.none;
    entry.none[k] = !entry.none[k];
    if (entry.none[k]) {
      if (k === "acne") Object.assign(entry, { acne: {}, acne_types: [] });
      if (k === "food") entry.food = [];
      if (k === "supplements") entry.supplements = [];
    }
    renderRecord();
    return scheduleSave();
  }
  const area = t.closest("[data-area]");
  if (area) {
    const id = area.dataset.area;
    const n = ((entry.acne[id] || 0) + 1) % 4;
    if (n) entry.acne[id] = n;
    else delete entry.acne[id];
    entry.none.acne = false;
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
    const group = chip.parentElement.dataset.group;
    toggleIn(getField(group), chip.dataset.v);
    if (group === "food") entry.none.food = false;
    if (group === "supplements") entry.none.supplements = false;
    renderRecord(); // 入力済みの数を更新する
    return scheduleSave();
  }
  const step = t.closest("[data-step]");
  if (step) {
    const cur = entry.sleep ?? 6.5; // 最初のタップで 6〜7時間から始める
    entry.sleep = Math.min(14, Math.max(0, cur + Number(step.dataset.step)));
    renderRecord();
    return scheduleSave();
  }
  if (t.closest("[data-copy]")) {
    const pe = normalize(prev.entry);
    entry.care = { am: [...pe.care.am], pm: [...pe.care.pm] };
    entry.products = { am: [...pe.products.am], pm: [...pe.products.pm] };
    entry.supplements = [...pe.supplements];
    entry.none.supplements = !!pe.none.supplements;
    collapsed.add("care");
    collapsed.add("intake");
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
  allProducts = s.products || [];
  entry = normalize(s.entry);
  initCollapsed();
  if (tab === "record") renderRecord();
}

$("#prev-day").addEventListener("click", () => guard(loadDay(shiftDate(date, -1))));
$("#next-day").addEventListener("click", () => {
  if (date < today) guard(loadDay(shiftDate(date, 1)));
});

// ---------- 履歴タブ ----------

const SKIN_CLASS = ["", "s1", "s2", "s3", "s4", "s5"];
let historyData = null; // { today, byDate }
let historyMonth = null; // 表示中の月 (YYYY-MM)

const monthLabel = (m) => `${Number(m.slice(0, 4))}年${Number(m.slice(5))}月`;
const shiftMonth = (m, n) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

async function renderHistory() {
  setHeader("履歴");
  if (!historyData) {
    main.innerHTML = `<p class="empty">読み込み中…</p>`;
    const h = await api("/api/history?days=400");
    historyData = { today: h.today, byDate: Object.fromEntries(h.entries.map((r) => [r.date, normalize(r.entry)])) };
  }
  if (tab !== "history") return;
  const { today: t, byDate } = historyData;
  historyMonth ??= t.slice(0, 7);
  const m = historyMonth;
  const first = `${m}-01`;
  const startDow = new Date(first + "T00:00:00Z").getUTCDay();
  const daysInMonth = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate();
  const oldest = shiftDate(t, -399).slice(0, 7);

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(`<span class="cal-cell blank"></span>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const d = `${m}-${String(day).padStart(2, "0")}`;
    const e = byDate[d];
    if (d > t) {
      cells.push(`<span class="cal-cell future"><span class="num">${day}</span></span>`);
      continue;
    }
    const marks = e ? `${acneTotal(e) ? `<i class="mk acne" title="ニキビ"></i>` : ""}${e.itch.level >= 2 ? `<i class="mk itch" title="かゆみ"></i>` : ""}${e.changes.length ? `<i class="mk change" title="変えたこと"></i>` : ""}` : "";
    const cls = !e ? "missing" : e.skin ? SKIN_CLASS[e.skin] : "noskin";
    cells.push(`<button class="cal-cell ${cls} ${d === t ? "today" : ""}" data-date="${d}"
      aria-label="${dateLabel(d)} ${e ? (e.skin ? SKIN[e.skin - 1] : "記録あり") : "未記録"}">
      <span class="num">${day}</span><span class="mks">${marks}</span></button>`);
  }

  // この月の数字
  const inMonth = Object.entries(byDate).filter(([d]) => d.startsWith(m)).map(([, e]) => e);
  const pastDays = m === t.slice(0, 7) ? Number(t.slice(8)) : daysInMonth;
  const skins = inMonth.map((e) => e.skin).filter(Boolean);
  const avg = skins.length ? (skins.reduce((a, b) => a + b, 0) / skins.length).toFixed(1) : "–";
  const acne = inMonth.reduce((a, e) => a + acneTotal(e), 0);
  const itchDays = inMonth.filter((e) => e.itch.level >= 2).length;

  main.innerHTML = `<section class="card cal-card">
      <div class="cal-nav">
        <button class="nav-btn" data-month="-1" aria-label="前の月" ${m <= oldest ? "disabled" : ""}>‹</button>
        <b>${monthLabel(m)}</b>
        <button class="nav-btn" data-month="1" aria-label="次の月" ${m >= t.slice(0, 7) ? "disabled" : ""}>›</button>
      </div>
      <div class="cal-grid">${[..."日月火水木金土"].map((w) => `<span class="cal-dow">${w}</span>`).join("")}${cells.join("")}</div>
      <div class="cal-legend">
        ${SKIN.map((l, i) => `<span><i class="sw ${SKIN_CLASS[i + 1]}"></i>${l}</span>`).join("")}
        <span><i class="sw missing"></i>未記録</span>
        <span><i class="mk acne"></i>ニキビ</span><span><i class="mk itch"></i>かゆい</span><span><i class="mk change"></i>変えたこと</span>
      </div>
    </section>
    <div class="tiles">
      <div class="tile"><span>記録した日</span><b>${inMonth.length}<small>/ ${pastDays}日</small></b></div>
      <div class="tile"><span>肌の調子（平均）</span><b>${avg}</b></div>
      <div class="tile"><span>新しいニキビ</span><b>${acne}<small>個</small></b></div>
      <div class="tile"><span>かゆかった日</span><b>${itchDays}<small>日</small></b></div>
    </div>
    <p class="hint center">日付をタップすると、その日の記録を開きます。</p>`;
}

main.addEventListener("click", (e) => {
  if (tab !== "history") return;
  const nav = e.target.closest("[data-month]");
  if (nav) {
    historyMonth = shiftMonth(historyMonth, Number(nav.dataset.month));
    return renderHistory();
  }
  const cell = e.target.closest(".cal-cell[data-date]");
  if (!cell) return;
  tab = "record";
  history.replaceState(null, "", "#record");
  updateTabs();
  guard(loadDay(cell.dataset.date).then(() => window.scrollTo(0, 0)));
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
  // 先頭に出す要点: 受診のすすめ > 来週ためすこと > おすすめアクション (合わせて3つまで)
  const todo = [
    ...(ai.see_doctor ? [["受診", "皮膚科の受診を検討する"]] : []),
    ...(ai.experiment?.action ? [["ためす", ai.experiment.action]] : []),
    ...(ai.actions || []).map((a) => ["する", a.action]),
  ].slice(0, 3);
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
    ${todo.length ? `<section class="card todo-card"><h2>今週やること</h2><ol class="todo">${todo.map(([kind, text]) =>
      `<li><span class="todo-kind">${kind}</span>${esc(text)}</li>`).join("")}</ol>
      <p class="hint">理由や詳しい内容は下にあります。</p></section>` : ""}
    <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
    ${areas.length ? `<p class="areas">ニキビの場所: ${areas.map(([a, n]) => `${esc(ACNE_AREAS[a] || a)} ${n}`).join(" · ")}</p>` : ""}
    ${counts(w.acne_type_days) ? `<p class="areas">ニキビの種類: ${counts(w.acne_type_days)}</p>` : ""}
    ${counts(w.skin_detail_days) ? `<p class="areas">肌の状態: ${counts(w.skin_detail_days)}</p>` : ""}

    ${card("今週のまとめ", `<p>${esc(ai.summary)}</p>`)}
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

let profileText = null; // 体質メモ (設定タブを開いたときに読む)

async function renderSettings() {
  setHeader("設定");
  if (profileText === null) profileText = (await api("/api/profile")).text;
  main.innerHTML = `<div class="settings">
    <section><h2>通知</h2><p id="push-msg">確認中…</p><div id="push-action"></div></section>
    ${itemEditor("care", "スキンケア")}
    ${itemEditor("food", "食べたもの")}
    <section><h2>体質メモ</h2>
      <p>遺伝子検査の結果や、皮膚科で言われたこと（アトピー体質、乾燥肌など）を書いておくと、
        週次レポートで参考にします。記録の傾向を優先し、これだけで決めつけることはしません。</p>
      <textarea id="profile" rows="6" maxlength="3000" placeholder="例: 皮膚科で乾燥肌と言われた / 遺伝子検査で紫外線の影響を受けやすいタイプだった">${esc(profileText ?? "")}</textarea>
      <div class="row-actions"><button class="btn" id="profile-save">保存</button><span class="hint" id="profile-msg"></span></div></section>
    <section><h2>データ</h2>
      <p>記録とレポートをすべて JSON ファイルで保存します（バックアップ用）。</p>
      <a class="btn ghost" href="/api/export" download>データを書き出す</a></section>
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
  } else if (e.target.id === "profile-save") {
    const text = $("#profile").value;
    e.target.disabled = true;
    try {
      await api("/api/profile", { method: "PUT", body: { text } });
      profileText = text.trim();
      $("#profile-msg").textContent = "保存しました ✓";
    } catch (err) {
      if (err instanceof LoginRequired) return renderLogin();
      $("#profile-msg").textContent = "保存できませんでした";
    }
    e.target.disabled = false;
    return;
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
  if (name === "history") {
    historyData = null;
    return renderHistory();
  }
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
  })());
}

// 新しい版を配信したら、開き直したときに自動で切り替える。
// iPhone のホーム画面アプリは裏で開いたままのことが多く、読み込み直さないと古い画面が残るため
let swReg = null;
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller; // 初めて開いたときは読み込み直さない
  navigator.serviceWorker.register("sw.js").then((reg) => { swReg = reg; }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", async () => {
    if (!hadController || reloading) return;
    reloading = true;
    await flushSave(); // 入力中の記録を保存してから
    location.reload();
  });
}

// 開き直したとき: 新しい版がないか確かめる。日付が変わっていたら今日の記録にする
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") return flushSave();
  swReg?.update().catch(() => {}); // 新しい版があれば取ってくる (あれば controllerchange で読み込み直す)
  if (entry && tab === "record" && date === today) {
    api("/api/state").then((s) => { if (s.today !== today) guard(loadDay()); }).catch(() => {});
  }
});

start();
