// 化粧品タブ: 使っている化粧品・日用品の登録と、Claude が調べた成分の表示。
// app.js の後に読み込み、app.js の関数 (api, esc, card, setHeader, guard など) を使う。

const FLAG_CLASS = { 刺激: "irritant", ニキビ: "acne", かぶれ: "allergy", 乾燥: "dry" };
// 種類と、記録タブのスキンケアのボタンの対応 (同じ名前のボタンがあればそれを使う)
const CARE_ITEM_FOR = { ひげ剃りフォーム: "ひげ剃り", アフターシェーブ: "ひげ剃り", クレンジング: "洗顔", 美容液: "化粧水" };
// 毎日使うと決まっていて、ボタンと結びつけなくてよい種類
const ALWAYS_USED = ["コンディショナー", "整髪料", "ボディソープ", "洗濯洗剤", "柔軟剤"];

let products = null; // { products: [...], categories: [...] }
let productView = { mode: "list", id: null }; // list | add | detail

async function loadProducts() {
  products = await api("/api/products");
}

function statusLabel(p) {
  if (p.status === "pending") return `<span class="pstatus pending">成分を調査中</span>`;
  if (p.status === "not_found") return `<span class="pstatus nf">成分が見つからない</span>`;
  const n = p.flags.length;
  return `<span class="pstatus ${n ? "warn" : "ok"}">${n ? `注意 ${n}` : "注意なし"}</span>`;
}

function productRow(p) {
  return `<button class="prow" data-product="${esc(p.id)}">
    <span class="pname">${esc(p.name)}</span>
    <span class="pmeta">${esc(p.category)}${p.started || p.ended
      ? ` · ${p.started ? md(p.started) : ""}〜${p.ended ? md(p.ended) : ""}` : ""}</span>
    ${statusLabel(p)}</button>`;
}

function renderProductList() {
  setHeader("化粧品・日用品");
  const list = products.products;
  const using = list.filter((p) => !p.ended);
  const past = list.filter((p) => p.ended);
  main.innerHTML = `<div class="products">
    <button class="btn block" id="product-add">＋ 製品を追加</button>
    ${list.length ? "" : `<p class="hint center">使っている化粧水・洗顔・シャンプー・洗濯洗剤などを登録すると、
      Claude が成分を調べ、週次レポートで記録と照らし合わせます。</p>`}
    ${using.length ? `<h2 class="group">使用中</h2><div class="plist">${using.map(productRow).join("")}</div>` : ""}
    ${past.length ? `<h2 class="group">使うのをやめた</h2><div class="plist">${past.map(productRow).join("")}</div>` : ""}
  </div>`;
}

function careOptions(category, selected) {
  const guess = items.care.includes(category) ? category : CARE_ITEM_FOR[category];
  const value = selected === undefined ? (ALWAYS_USED.includes(category) ? "" : guess || "") : selected || "";
  return `<option value="">結びつけない（使用期間中は毎日使う）</option>` + items.care.map((c) =>
    `<option value="${esc(c)}" ${c === value ? "selected" : ""}>「${esc(c)}」を押した日に使う</option>`).join("");
}

function renderProductAdd() {
  setHeader("製品を追加");
  const cats = products.categories;
  main.innerHTML = `<form class="pform" id="pform">
    <button type="button" class="link-btn back" data-back>‹ 一覧に戻る</button>
    <label>商品名<small>メーカー名も入れると見つけやすくなります（例: 〇〇 薬用化粧水 さっぱり）</small>
      <input name="name" required maxlength="80" autocomplete="off"></label>
    <label>種類<select name="category">${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select></label>
    <label>記録との結びつけ<select name="care_item">${careOptions(cats[0])}</select></label>
    <fieldset><legend>使い始め</legend>
      <label class="radio"><input type="radio" name="when" value="before" checked> 前から使っている</label>
      <label class="radio"><input type="radio" name="when" value="today"> 今日から（替えた）</label>
      <label class="radio"><input type="radio" name="when" value="date"> 日付を指定 <input type="date" name="started" max="${today}"></label>
    </fieldset>
    <label class="radio replace" hidden><input type="checkbox" name="replace" checked> <span></span></label>
    <button class="btn block" type="submit">登録する</button>
    <p class="hint">登録すると、1時間以内（7〜23時）に Claude が Web で全成分を調べます。
      替えた日を指定すると、その日の記録の「変えたこと」にも自動で入ります。</p>
  </form>`;
  updateReplace();
}

// 同じ種類の使用中の製品があり、使い始めを「替えた」にしたときだけ「前の製品をやめる」を出す
function updateReplace() {
  const f = $("#pform");
  if (!f) return;
  const others = products.products.filter((p) => !p.ended && p.category === f.category.value);
  const box = f.querySelector(".replace");
  box.hidden = !others.length || f.when.value === "before";
  box.querySelector("span").textContent = `「${others.map((p) => p.name).join("」「")}」は前日で使うのをやめたことにする`;
}

async function submitProduct(f) {
  const when = f.when.value;
  const started = when === "today" ? today : when === "date" ? f.started.value : null;
  if (when === "date" && !started) return alert("日付を選んでください");
  f.querySelector("[type=submit]").disabled = true;
  try {
    await api("/api/products", { method: "POST", body: {
      name: f.name.value, category: f.category.value, care_item: f.care_item.value, started,
      replace: !f.querySelector(".replace").hidden && f.replace.checked,
    } });
    await loadProducts();
    productView = { mode: "list", id: null };
    renderProducts();
  } catch (err) {
    if (err instanceof LoginRequired) return renderLogin();
    alert("登録できませんでした");
    f.querySelector("[type=submit]").disabled = false;
  }
}

function renderProductDetail() {
  const p = products.products.find((x) => x.id === productView.id);
  if (!p) {
    productView = { mode: "list", id: null };
    return renderProductList();
  }
  setHeader(p.category);
  const flagged = new Map(p.flags.map((f) => [f.ingredient, f]));
  let result = "";
  if (p.status === "pending") {
    result = `<p class="muted">${p.mode === "manual" ? "貼り付けた成分を" : "Claude が Web で全成分を"}調べています。
      1時間以内（7〜23時）に結果が出ます。</p>`;
  } else {
    result = `${p.status === "not_found" ? `<p class="warn-text">全成分を確認できませんでした。${esc(p.note)}</p>` : ""}
      ${p.summary ? `<p>${esc(p.summary)}</p>` : ""}
      ${p.matched_name && p.matched_name !== p.name ? `<p class="hint">見つかった商品: ${esc(p.matched_name)}（違う商品なら名前を直すか、成分を貼り付けてください）</p>` : ""}
      ${p.status === "done" && p.note ? `<p class="hint">${esc(p.note)}</p>` : ""}
      ${p.flags.length ? `<h3>注意したい成分</h3><ul class="rlist">${p.flags.map((f) =>
        `<li><div class="rhead"><b>${esc(f.ingredient)}</b><span class="flag ${FLAG_CLASS[f.type] || ""}">${esc(f.type)}</span></div>
          <p>${esc(f.reason)}</p></li>`).join("")}</ul>` : ""}
      ${p.ingredients.length ? `<h3>全成分（${p.ingredients.length}）</h3><p class="ingredients">${p.ingredients.map((x) =>
        `<span class="${flagged.has(x) ? `hit ${FLAG_CLASS[flagged.get(x).type] || ""}` : ""}">${esc(x)}</span>`).join("、")}</p>` : ""}
      ${p.sources.length ? `<p class="hint">調べたページ: ${p.sources.map((u) => {
        let host = u;
        try { host = new URL(u).hostname; } catch {}
        return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(host)}</a>`;
      }).join("、")}</p>` : ""}`;
  }
  main.innerHTML = `<div class="pdetail">
    <button class="link-btn back" data-back>‹ 一覧に戻る</button>
    <h2 class="ptitle">${esc(p.name)}</h2>
    <p class="pmeta">${p.started ? `${esc(dateLabel(p.started, true))}から` : "前から"}${p.ended ? `${esc(dateLabel(p.ended, true))}まで` : "使用中"}
      · ${p.care_item ? `「${esc(p.care_item)}」を押した日に使用` : "使用期間中は毎日"}</p>
    ${card("成分", result)}
    <section class="card"><h2>成分表示を貼り付ける</h2>
      <p class="hint">見つからないときや違う商品だったときは、パッケージや公式サイトの全成分を貼り付けてください。</p>
      <textarea id="ing-text" rows="4" placeholder="水、グリセリン、BG、…">${esc(p.ingredients_text)}</textarea>
      <button class="btn ghost" id="ing-save">この成分で調べ直す</button></section>
    <div class="pactions">
      <button class="btn ghost" id="p-rename">名前を直す</button>
      <button class="btn ghost" id="p-research">Web で調べ直す</button>
      <label class="btn ghost">記録との結びつけ<select id="p-care">${careOptions(p.category, p.care_item)}</select></label>
      ${p.ended ? `<button class="btn ghost" id="p-reuse">使用中に戻す</button>`
        : `<button class="btn ghost" id="p-end">今日で使うのをやめた</button>`}
      <button class="btn ghost danger" id="p-delete">削除</button>
    </div>
  </div>`;
}

async function updateProduct(body) {
  const id = productView.id;
  try {
    await api(`/api/products/${id}`, { method: "PUT", body });
    await loadProducts();
    if (tab === "products") renderProducts();
  } catch (err) {
    if (err instanceof LoginRequired) return renderLogin();
    alert("保存できませんでした");
  }
}

function renderProducts() {
  window.scrollTo(0, 0);
  if (productView.mode === "add") return renderProductAdd();
  if (productView.mode === "detail") return renderProductDetail();
  return renderProductList();
}

async function showProducts() {
  setHeader("化粧品・日用品");
  if (!products) {
    main.innerHTML = `<p class="empty">読み込み中…</p>`;
    await loadProducts();
  }
  if (tab === "products") renderProducts();
}

main.addEventListener("click", async (e) => {
  if (tab !== "products") return;
  const t = e.target;
  if (t.closest("[data-back]")) {
    productView = { mode: "list", id: null };
    return guard(loadProducts().then(renderProducts));
  }
  if (t.id === "product-add") {
    productView = { mode: "add", id: null };
    return renderProducts();
  }
  const row = t.closest("[data-product]");
  if (row) {
    productView = { mode: "detail", id: row.dataset.product };
    return renderProducts();
  }
  const p = products?.products.find((x) => x.id === productView.id);
  if (!p) return;
  if (t.id === "ing-save") {
    const v = $("#ing-text").value.trim();
    if (!v) return alert("成分を貼り付けてください");
    return updateProduct({ ingredients_text: v });
  }
  if (t.id === "p-rename") {
    const name = (prompt("商品名", p.name) || "").trim();
    if (name && name !== p.name) return updateProduct({ name });
  }
  if (t.id === "p-research") return updateProduct({ research: true });
  if (t.id === "p-end") return updateProduct({ ended: today });
  if (t.id === "p-reuse") return updateProduct({ ended: null });
  if (t.id === "p-delete") {
    if (!confirm(`「${p.name}」を削除しますか？（使用期間の記録も消え、分析に使われなくなります。使うのをやめただけなら「今日で使うのをやめた」を押してください）`)) return;
    await api(`/api/products/${p.id}`, { method: "DELETE" }).catch(() => {});
    productView = { mode: "list", id: null };
    return guard(loadProducts().then(renderProducts));
  }
});

main.addEventListener("change", (e) => {
  if (tab !== "products") return;
  const f = $("#pform");
  if (f && e.target.name === "category") {
    f.care_item.innerHTML = careOptions(e.target.value);
    updateReplace();
  }
  if (f && (e.target.name === "when" || e.target.name === "started")) {
    if (e.target.name === "started") f.querySelector('[value="date"]').checked = true;
    updateReplace();
  }
  if (e.target.id === "p-care") updateProduct({ care_item: e.target.value });
});

main.addEventListener("submit", (e) => {
  if (tab !== "products" || e.target.id !== "pform") return;
  e.preventDefault();
  submitProduct(e.target);
});
