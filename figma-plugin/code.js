/**
 * Lean Quest → Figma Export — プラグイン本体（Phase 1）
 *
 * ExportBundle(JSON) を受け取り、section→Figma マッピング（docs/design/figma-export.md）に
 * 沿って各画面を Figma に生成する。PoC で検証したレシピを、section.type 駆動の
 * 汎用レンダラに一般化したもの。Phase 1 は生ノード＋選択テーマの塗り（Variables は Phase 2）。
 */

figma.showUI(__html__, { width: 380, height: 470 });

let C = null; // 現在のテーマトークン（buildAll で設定）

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "generate") return;
  try {
    const n = await buildAll(msg.bundle, msg.theme);
    figma.notify(`${n} 画面を生成しました`);
    // fileKey を返すと、UI 側がトークン URL 由来のとき callback で figmaUrl を保存できる。
    figma.ui.postMessage({ type: "done", count: n, fileKey: figma.fileKey });
  } catch (e) {
    figma.ui.postMessage({ type: "error", message: (e && e.message) || String(e) });
  }
};

// ---- 色・レイアウトヘルパー（PoC と同等） ----
const hexToRgb = (h) => {
  const s = String(h || "#000000").replace("#", "");
  const v = s.length === 3 ? s.split("").map((c) => c + c).join("") : s.padEnd(6, "0").slice(0, 6);
  const n = parseInt(v, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};
const solid = (c, o) => [{ type: "SOLID", color: typeof c === "string" ? hexToRgb(c) : c, opacity: o == null ? 1 : o }];
const col = (name, gap) => { const f = figma.createFrame(); f.name = name; f.layoutMode = "VERTICAL"; f.primaryAxisSizingMode = "AUTO"; f.counterAxisSizingMode = "AUTO"; f.itemSpacing = gap || 0; f.fills = []; return f; };
const rowf = (name, gap) => { const f = figma.createFrame(); f.name = name; f.layoutMode = "HORIZONTAL"; f.primaryAxisSizingMode = "AUTO"; f.counterAxisSizingMode = "AUTO"; f.itemSpacing = gap || 0; f.fills = []; return f; };
const T = (chars, o) => { o = o || {}; const t = figma.createText(); t.fontName = { family: "Noto Sans JP", style: o.style || "Regular" }; t.characters = String(chars); t.fontSize = o.size || 14; t.fills = solid(o.color || C.content, o.opacity == null ? 1 : o.opacity); return t; };

const fieldBox = (ph, w) => { const f = rowf("field", 8); f.fills = solid(C.base100); f.strokes = solid(C.base300); f.strokeWeight = 1; f.cornerRadius = 8; f.counterAxisAlignItems = "CENTER"; f.paddingLeft = 12; f.paddingRight = 12; f.resize(w, 38); f.appendChild(T(ph, { size: 13, opacity: 0.45 })); return f; };
const selBox = (ph, w) => { const f = rowf("select", 0); f.fills = solid(C.base100); f.strokes = solid(C.base300); f.strokeWeight = 1; f.cornerRadius = 8; f.counterAxisAlignItems = "CENTER"; f.primaryAxisAlignItems = "SPACE_BETWEEN"; f.paddingLeft = 12; f.paddingRight = 10; f.resize(w, 38); f.appendChild(T(ph, { size: 13, opacity: 0.78 })); f.appendChild(T("▾", { size: 11, opacity: 0.5 })); return f; };
const inpBox = (v, w) => { const f = rowf("inp", 8); f.fills = solid(C.base100); f.strokes = solid(C.base300); f.strokeWeight = 1; f.cornerRadius = 8; f.counterAxisAlignItems = "CENTER"; f.paddingLeft = 12; f.paddingRight = 12; f.resize(w, 40); f.appendChild(T(v, { size: 14 })); return f; };
const btn = (label) => { const b = rowf("btn", 8); b.fills = solid(C.primary); b.cornerRadius = 8; b.counterAxisAlignItems = "CENTER"; b.primaryAxisAlignItems = "CENTER"; b.paddingLeft = 18; b.paddingRight = 18; b.resize(10, 40); b.primaryAxisSizingMode = "AUTO"; b.appendChild(T(label, { size: 14, style: "Medium", color: "#FFFFFF" })); return b; };
const obtn = (label) => { const b = rowf("obtn", 8); b.fills = []; b.strokes = solid(C.base300); b.strokeWeight = 1; b.cornerRadius = 8; b.counterAxisAlignItems = "CENTER"; b.primaryAxisAlignItems = "CENTER"; b.paddingLeft = 16; b.paddingRight = 16; b.resize(10, 40); b.primaryAxisSizingMode = "AUTO"; b.appendChild(T(label, { size: 14, style: "Medium", opacity: 0.85 })); return b; };
const toggle = (on) => { const t = rowf("toggle", 0); t.fills = solid(on ? C.primary : C.base300); t.cornerRadius = 999; t.paddingLeft = 2; t.paddingRight = 2; t.counterAxisAlignItems = "CENTER"; t.primaryAxisAlignItems = on ? "MAX" : "MIN"; t.resize(44, 24); const k = figma.createEllipse(); k.resize(20, 20); k.fills = solid("#FFFFFF"); t.appendChild(k); return t; };
const badge = (text, c) => { const b = rowf("badge", 0); b.fills = solid(c, 0.16); b.cornerRadius = 999; b.counterAxisAlignItems = "CENTER"; b.primaryAxisAlignItems = "CENTER"; b.paddingLeft = 10; b.paddingRight = 10; b.paddingTop = 3; b.paddingBottom = 3; b.resize(10, 10); b.primaryAxisSizingMode = "AUTO"; b.counterAxisSizingMode = "AUTO"; b.appendChild(T(text, { size: 12, style: "Medium", color: c })); return b; };
const sectionCard = (title) => { const c = col("card", 12); c.fills = solid(C.base100); c.strokes = solid(C.base300); c.strokeWeight = 1; c.cornerRadius = 16; c.paddingTop = 20; c.paddingBottom = 20; c.paddingLeft = 20; c.paddingRight = 20; c.resize(100, 1); c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "FIXED"; if (title) c.appendChild(T(title, { size: 15, style: "Bold" })); return c; };
const cellBox = (w, node, head) => { const c = rowf("cell", 0); c.counterAxisAlignItems = "CENTER"; c.paddingLeft = 14; c.paddingRight = 10; c.paddingTop = head ? 10 : 12; c.paddingBottom = head ? 10 : 12; c.resize(w, head ? 40 : 48); c.appendChild(node); return c; };

// ---- 値・色の汎用ロジック ----
const PALETTE = ["#6B8FA3", "#7A6FAE", "#C0894E", "#5E9E78", "#9AA0A6"];
const isAction = (s) => /(する|作成|追加|エクスポート|更新|削除|実行|管理|設定|割り当て|転換|完了|保存|送付|記録|転換)$|を作成|を追加/.test(s);
const isBadgeCol = (s) => /ステータス|ステージ|結果|優先度|確度|有効|ロール|種別|フラグ/.test(s);
const cleanFilter = (s) => s.replace(/で(絞り込む|並び替える|並べ替える)$/, "").replace(/する$/, "");
function sampleFor(col2, i) {
  const c = col2;
  if (/会社名|商談名|タスク名|氏名|表示名|項目名|テリトリー名|名$/.test(c)) return ["株式会社山田製作所", "グリーンフーズ", "ABCロジスティクス", "みらいクリニック"][i % 4];
  if (/金額/.test(c)) return ["¥4,800,000", "¥1,200,000", "¥7,500,000", "¥980,000"][i % 4];
  if (/メール/.test(c)) return ["sales@example.co.jp", "info@example.jp", "contact@abc.co.jp", "hello@mirai.jp"][i % 4];
  if (/電話/.test(c)) return ["03-1234-5678", "06-2222-3333", "092-4444-5555", "052-6666-7777"][i % 4];
  if (/日時/.test(c)) return ["2026/06/20 14:30", "2026/06/18 09:00", "2026/06/15 16:20", "2026/06/10 11:00"][i % 4];
  if (/日$/.test(c)) return ["2026/06/20", "2026/06/18", "2026/06/15", "2026/06/10"][i % 4];
  if (/スコア/.test(c)) return ["85", "72", "60", "90"][i % 4];
  if (/担当|記録者|実行者|営業/.test(c)) return ["佐藤", "田中", "渡辺", "鈴木"][i % 4];
  if (/業種/.test(c)) return ["製造業", "飲食", "物流", "医療"][i % 4];
  if (/件数|数$/.test(c)) return ["12", "8", "5", "20"][i % 4];
  return ["サンプル", "データ", "値", "—"][i % 4];
}
function badgeVal(col2, i) {
  if (/確度/.test(col2)) { const v = ["85", "60", "90", "45"][i % 4]; return { t: v, c: +v >= 80 ? "#5E9E78" : +v >= 60 ? "#6B8FA3" : "#9AA0A6" }; }
  if (/優先度/.test(col2)) { const v = ["高", "中", "低", "中"][i % 4]; return { t: v, c: v === "高" ? "#C0894E" : v === "中" ? "#6B8FA3" : "#9AA0A6" }; }
  if (/有効|フラグ/.test(col2)) { const v = ["有効", "有効", "無効", "有効"][i % 4]; return { t: v, c: v === "有効" ? "#5E9E78" : "#9AA0A6" }; }
  const v = ["新規", "商談中", "受注", "失注"][i % 4];
  return { t: v, c: PALETTE[i % PALETTE.length] };
}

// ---- セクションレンダラ（type 駆動） ----
function splitItems(items) {
  const list = items || [];
  return { actions: list.filter(isAction), fields: list.filter((s) => !isAction(s)) };
}
function fillRow(parent, node) { parent.appendChild(node); node.layoutSizingHorizontal = "FILL"; }

function renderHeader(content, sec) {
  const { actions, fields } = splitItems(sec.items);
  const r = rowf("header", 12); r.primaryAxisAlignItems = "SPACE_BETWEEN"; r.counterAxisAlignItems = "CENTER";
  const left = col("ttl", 2); left.appendChild(T(sec.label, { size: 22, style: "Bold" }));
  if (fields.length) left.appendChild(T(fields.slice(0, 3).join(" ・ "), { size: 13, opacity: 0.6 }));
  r.appendChild(left);
  if (actions.length) { const ar = rowf("acts", 10); actions.slice(0, 3).forEach((a, i) => ar.appendChild(i === 0 ? btn(a) : obtn(a))); r.appendChild(ar); }
  fillRow(content, r);
}

function renderToolbar(content, sec) {
  const { actions, fields } = splitItems(sec.items);
  const bar = rowf("toolbar", 12); bar.counterAxisAlignItems = "CENTER"; bar.primaryAxisAlignItems = "SPACE_BETWEEN";
  const filters = rowf("filters", 8); filters.counterAxisAlignItems = "CENTER";
  fields.forEach((f) => { if (/検索/.test(f)) filters.appendChild(fieldBox(f, 240)); else filters.appendChild(selBox(cleanFilter(f), 116)); });
  bar.appendChild(filters);
  if (actions.length) bar.appendChild(btn("＋ " + actions[0]));
  fillRow(content, bar);
}

function renderKpi(content, sec) {
  const card = sectionCard(sec.label);
  const grid = rowf("kpi", 12);
  (sec.items || []).slice(0, 6).forEach((k, i) => {
    const s = col("stat", 6); s.fills = solid(C.base200, 0.5); s.strokes = solid(C.base300); s.strokeWeight = 1; s.cornerRadius = 12; s.paddingTop = 14; s.paddingBottom = 14; s.paddingLeft = 14; s.paddingRight = 14; s.resize(100, 1); s.primaryAxisSizingMode = "AUTO"; s.counterAxisSizingMode = "FIXED";
    s.appendChild(T(k, { size: 11, opacity: 0.55 }));
    s.appendChild(T(["42", "¥12.4M", "28%", "91%", "76%", "+12%"][i % 6], { size: 22, style: "Bold" }));
    grid.appendChild(s); s.layoutSizingHorizontal = "FILL";
  });
  card.appendChild(grid); grid.layoutSizingHorizontal = "FILL";
  fillRow(content, card);
}

function renderChart(content, sec) {
  const card = sectionCard(sec.label);
  const chart = rowf("chart", 18); chart.counterAxisAlignItems = "MAX"; chart.primaryAxisAlignItems = "CENTER"; chart.paddingTop = 8;
  const heights = [120, 95, 64, 90, 50, 110, 75];
  (sec.items || []).slice(0, 6).forEach((lab, i) => {
    const u = col("u", 6); u.counterAxisAlignItems = "CENTER";
    const b = figma.createRectangle(); b.resize(40, heights[i % heights.length]); b.cornerRadius = 6; b.fills = solid(i % 2 ? C.accent : C.primary, 0.85);
    u.appendChild(b); u.appendChild(T(String(lab).slice(0, 8), { size: 10, opacity: 0.6 }));
    chart.appendChild(u);
  });
  card.appendChild(chart); chart.layoutSizingHorizontal = "FILL";
  fillRow(content, card);
}

function renderTable(content, sec) {
  const cols = (sec.items || []).filter((s) => !isAction(s)).slice(0, 8);
  if (!cols.length) return renderList(content, sec);
  const card = sectionCard(sec.label);
  const tbl = col("table", 0); tbl.strokes = solid(C.base300); tbl.strokeWeight = 1; tbl.cornerRadius = 10; tbl.clipsContent = true; tbl.resize(100, 1); tbl.primaryAxisSizingMode = "AUTO"; tbl.counterAxisSizingMode = "FIXED";
  const hr = rowf("thead", 0); hr.fills = solid(C.base200);
  cols.forEach((h) => { const c = cellBox(140, T(h, { size: 12, style: "Bold", opacity: 0.6 }), true); hr.appendChild(c); c.layoutSizingHorizontal = "FILL"; });
  tbl.appendChild(hr); hr.layoutSizingHorizontal = "FILL";
  for (let i = 0; i < 4; i++) {
    const tr = rowf("row", 0); tr.fills = solid(i % 2 ? C.base200 : C.base100);
    cols.forEach((colName, ci) => {
      let node;
      if (isBadgeCol(colName)) { const bv = badgeVal(colName, i); node = badge(bv.t, bv.c); }
      else node = T(sampleFor(colName, i), { size: 13, opacity: ci === 0 ? 1 : 0.82, style: ci === 0 ? "Medium" : "Regular" });
      const c = cellBox(140, node, false); tr.appendChild(c); c.layoutSizingHorizontal = "FILL";
    });
    tbl.appendChild(tr); tr.layoutSizingHorizontal = "FILL";
  }
  card.appendChild(tbl); tbl.layoutSizingHorizontal = "FILL";
  fillRow(content, card);
}

function renderList(content, sec) {
  const card = sectionCard(sec.label);
  const cols = (sec.items || []).filter((s) => !isAction(s));
  for (let i = 0; i < 3; i++) {
    const r = rowf("li", 0); r.primaryAxisAlignItems = "SPACE_BETWEEN"; r.counterAxisAlignItems = "CENTER"; r.paddingTop = 8; r.paddingBottom = 8;
    const c = col("lc", 2);
    c.appendChild(T(sampleFor(cols[0] || "名", i), { size: 13, style: "Medium" }));
    if (cols.length > 1) c.appendChild(T(cols.slice(1, 4).map((x) => `${x}: ${sampleFor(x, i)}`).join(" ・ "), { size: 11, opacity: 0.55 }));
    r.appendChild(c);
    const badgeCol = cols.find(isBadgeCol);
    if (badgeCol) { const bv = badgeVal(badgeCol, i); r.appendChild(badge(bv.t, bv.c)); }
    fillRow(card, r);
  }
  fillRow(content, card);
}

function renderTimeline(content, sec) {
  const card = sectionCard(sec.label);
  const samples = [["メール", "見積書を送付", "2026/06/20", "#6B8FA3"], ["通話", "要件ヒアリング", "2026/06/12", "#7BBFA0"], ["面談", "初回訪問・ニーズ確認", "2026/06/01", "#C0894E"]];
  samples.forEach((a) => {
    const r = rowf("tl", 10); r.counterAxisAlignItems = "CENTER";
    const d = figma.createEllipse(); d.resize(10, 10); d.fills = solid(a[3]); r.appendChild(d);
    const cc = col("c", 1); cc.appendChild(T(a[1], { size: 13, style: "Medium" }));
    const m = rowf("m", 6); m.appendChild(T(a[0], { size: 11, color: a[3], style: "Medium" })); m.appendChild(T(a[2], { size: 11, opacity: 0.5 }));
    cc.appendChild(m); r.appendChild(cc);
    fillRow(card, r);
  });
  fillRow(content, card);
}

function renderForm(content, sec) {
  const { actions, fields } = splitItems(sec.items);
  const card = sectionCard(sec.label);
  fields.forEach((f) => {
    const wrap = col("field", 6); wrap.appendChild(T(f, { size: 13, opacity: 0.7 }));
    let ctrl;
    if (/種別|選択|対象|ロール|ポリシー|タイムアウト|ステージ|ステータス/.test(f)) ctrl = selBox(sampleFor(f, 0) === "—" ? "選択してください" : sampleFor(f, 0), 240);
    else ctrl = inpBox(sampleFor(f, 0), 320);
    wrap.appendChild(ctrl); fillRow(card, wrap); ctrl.layoutSizingHorizontal = "FILL";
  });
  if (actions.length) { const ar = rowf("acts", 10); ar.appendChild(btn(actions[0])); actions.slice(1, 3).forEach((a) => ar.appendChild(obtn(a))); card.appendChild(ar); }
  fillRow(content, card);
}

function renderDetail(content, sec) {
  const { actions, fields } = splitItems(sec.items);
  const card = sectionCard(sec.label);
  // KV グリッド（4列）
  const flat = fields.slice(0, 12);
  for (let i = 0; i < flat.length; i += 4) {
    const r = rowf("gr", 16);
    for (let j = i; j < i + 4 && j < flat.length; j++) {
      const kv = col("kv", 2); kv.appendChild(T(flat[j], { size: 11, opacity: 0.5 })); kv.appendChild(T(sampleFor(flat[j], j), { size: 14 }));
      kv.resize(150, 1); kv.primaryAxisSizingMode = "AUTO"; kv.counterAxisSizingMode = "FIXED";
      r.appendChild(kv); kv.layoutSizingHorizontal = "FILL";
    }
    fillRow(card, r);
  }
  if (actions.length) { const ar = rowf("acts", 10); actions.slice(0, 4).forEach((a, i) => ar.appendChild(i === 0 ? btn(a) : obtn(a))); card.appendChild(ar); }
  fillRow(content, card);
}

function renderOther(content, sec) {
  const card = sectionCard(sec.label);
  (sec.items || []).slice(0, 6).forEach((it) => card.appendChild(T("• " + it, { size: 13, opacity: 0.8 })));
  fillRow(content, card);
}

const RENDERERS = { header: renderHeader, toolbar: renderToolbar, kpi: renderKpi, chart: renderChart, table: renderTable, list: renderList, timeline: renderTimeline, form: renderForm, detail: renderDetail, calendar: renderTable, cards: renderList, map: renderOther, footer: renderOther, sidebar: renderOther, other: renderOther };

// ---- シェル（サイドバー + ナビ + コンテンツ） ----
function buildScreen(bundle, screen, x) {
  const sc = figma.createFrame(); sc.name = `${screen.screenName} / ${bundle.meta.productName}`; sc.layoutMode = "HORIZONTAL"; sc.itemSpacing = 0; sc.fills = solid(C.base200); sc.resize(1440, 100); sc.primaryAxisSizingMode = "FIXED"; sc.counterAxisSizingMode = "AUTO"; sc.x = x; sc.y = 0;
  // sidebar
  const side = col("Sidebar", 8); side.fills = solid(C.base100); side.paddingTop = 20; side.paddingBottom = 20; side.paddingLeft = 14; side.paddingRight = 14; side.resize(250, 100);
  sc.appendChild(side); side.layoutSizingVertical = "FILL";
  const brand = col("Brand", 4); const brow = rowf("brow", 8); brow.counterAxisAlignItems = "CENTER";
  const logo = figma.createRectangle(); logo.resize(28, 28); logo.cornerRadius = 8; logo.fills = solid(C.primary); brow.appendChild(logo); brow.appendChild(T(bundle.meta.productName, { size: 18, style: "Bold", color: C.primary }));
  brand.appendChild(brow); side.appendChild(brand); brand.layoutSizingHorizontal = "FILL";
  const menu = col("Menu", 4);
  const tops = (bundle.navigation || []).filter((n) => !n.parent);
  (tops.length ? tops : [{ label: screen.screenName }]).forEach((n) => {
    const active = n.label === screen.screenName || (n.targetObject && n.targetObject === screen.targetObject);
    const it = rowf("item", 10); it.counterAxisAlignItems = "CENTER"; it.paddingLeft = 12; it.paddingRight = 12; it.paddingTop = 10; it.paddingBottom = 10; it.cornerRadius = 8; it.fills = active ? solid(C.primary) : [];
    const ic = figma.createRectangle(); ic.resize(18, 18); ic.cornerRadius = 5; ic.fills = solid(active ? "#FFFFFF" : C.content, active ? 0.35 : 0.18); it.appendChild(ic);
    it.appendChild(T(n.label, { size: 14, style: active ? "Medium" : "Regular", color: active ? "#FFFFFF" : C.content, opacity: active ? 1 : 0.8 }));
    menu.appendChild(it); it.layoutSizingHorizontal = "FILL";
  });
  side.appendChild(menu); menu.layoutSizingHorizontal = "FILL";
  // main
  const main = col("Main", 0); main.fills = []; main.resize(1190, 100); main.primaryAxisSizingMode = "AUTO"; // 高さは内容に合わせて hug（resize で FIXED に戻るため再設定）
  sc.appendChild(main); main.layoutSizingHorizontal = "FILL";
  const nav = rowf("Navbar", 0); nav.fills = solid(C.base100); nav.counterAxisAlignItems = "CENTER"; nav.primaryAxisAlignItems = "SPACE_BETWEEN"; nav.paddingLeft = 24; nav.paddingRight = 24; nav.resize(1190, 64); nav.counterAxisSizingMode = "FIXED";
  nav.appendChild(T(screen.screenName, { size: 18, style: "Bold" }));
  const nr = rowf("navright", 12); nr.counterAxisAlignItems = "CENTER"; nr.appendChild(fieldBox("キーワード検索…", 240)); const av = figma.createEllipse(); av.resize(36, 36); av.fills = solid(C.secondary); nr.appendChild(av); nav.appendChild(nr);
  main.appendChild(nav); nav.layoutSizingHorizontal = "FILL";
  const content = col("Content", 16); content.fills = []; content.paddingTop = 24; content.paddingBottom = 24; content.paddingLeft = 24; content.paddingRight = 24; content.resize(1190, 1); content.primaryAxisSizingMode = "AUTO"; // 高さは hug
  main.appendChild(content); content.layoutSizingHorizontal = "FILL";
  (screen.sections || []).forEach((sec) => {
    const r = RENDERERS[sec.type] || renderOther;
    try { r(content, sec); } catch (e) { /* セクション単位で握りつぶし、他を続行 */ }
  });
  return sc;
}

function pickTokens(bundle, key) {
  if (key === "dark") return bundle.brand.dark;
  if (key && key.indexOf("opt:") === 0) { const i = +key.slice(4); const o = (bundle.brand.paletteOptions || [])[i]; if (o && o.tokens) return o.tokens; }
  return bundle.brand.light;
}

async function buildAll(bundle, themeKey) {
  for (const s of ["Regular", "Medium", "Bold"]) await figma.loadFontAsync({ family: "Noto Sans JP", style: s });
  C = pickTokens(bundle, themeKey);
  const made = [];
  let x = 0;
  for (const screen of bundle.screens) { made.push(buildScreen(bundle, screen, x)); x += 1520; }
  if (made.length) { figma.currentPage.selection = made; figma.viewport.scrollAndZoomIntoView(made); }
  return made.length;
}
