/**
 * 分析成果物（OOUIオブジェクト / アクター・ユースケース）から mermaid ソースを組み立てる。
 * 純データ変換なのでクライアント・サーバ双方から安全に使える。
 *
 * 日本語名でもシンタックスエラーにならないよう、ノード/クラスには合成 ASCII の ID を割り当て、
 * 表示名は `id["ラベル"]` 構文に分離してエスケープする。
 */

export type OouiForDiagram = {
  name: string;
  attributes?: { name: string; label?: string | null }[] | null;
  actions?: { name: string; label?: string | null }[] | null;
  relations?: {
    to: string;
    type?: string | null;
    cardinality?: string | null;
  }[] | null;
  collectionOf?: string | null;
};

export type ActorForDiagram = { name: string; kind?: string | null };
export type UseCaseForDiagram = { goal: string; actorName?: string | null };
export type NavForFlow = {
  label: string;
  screenType?: string | null;
  parent?: string | null;
  icon?: string | null;
  /** 対応する OOUI オブジェクト名（画面遷移にモデリングの関係を反映する照合キー） */
  targetObject?: string | null;
};

/**
 * 角括弧・引用符内ラベル用のエスケープ。
 * mermaid のパーサを壊しうる文字を除去/置換しつつ、日本語はそのまま残す。
 */
function label(raw: string): string {
  return (
    raw
      .replace(/[\r\n]+/g, " ")
      .replace(/"/g, "'") // 二重引用符は ["..."] を壊す
      .replace(/[[\]{}|<>#`;]/g, "") // mermaid 特殊記号
      .replace(/\s+/g, " ")
      .trim() || "(無題)"
  );
}

/**
 * classDiagram のメンバー名（属性・メソッド）用。
 * `()` `:` 等のメンバー構文に使われる記号を除去し、空白は _ に。日本語は残す。
 */
function member(raw: string): string {
  return raw
    .replace(/[()（）:：~+\-#<>"{}|,;]/g, "")
    .replace(/\s+/g, "_")
    .trim();
}

/** OOUIオブジェクト → classDiagram（合成IDで日本語名でも安全） */
export function oouiToClassDiagram(objects: OouiForDiagram[]): string {
  if (!objects.length) return "classDiagram\n  class C0[\"(なし)\"]";

  const ids = new Map<string, string>();
  objects.forEach((o, i) => ids.set(o.name, `C${i}`));

  const lines: string[] = ["classDiagram"];
  for (const o of objects) {
    const id = ids.get(o.name) ?? "C";
    lines.push(`  class ${id}["${label(o.name)}"] {`);
    for (const a of o.attributes ?? []) {
      const m = member(a.label || a.name);
      if (m) lines.push(`    +${m}`);
    }
    for (const act of o.actions ?? []) {
      const m = member(act.label || act.name);
      if (m) lines.push(`    +${m}()`);
    }
    lines.push(`  }`);
  }
  for (const o of objects) {
    const from = ids.get(o.name);
    for (const rel of o.relations ?? []) {
      const to = ids.get(rel.to);
      if (from && to) {
        const t = rel.type ? label(rel.type).replace(/:/g, "") : "";
        lines.push(`  ${from} --> ${to}${t ? ` : ${t}` : ""}`);
      }
    }
  }
  return lines.join("\n");
}

/** OOUI の関係が「親→子（包含）」を表すか。
 *  多重度 1対多（自分が1、相手が多）を正とし、無い場合は関係種別の語で補う。 */
function isContainment(rel: {
  type?: string | null;
  cardinality?: string | null;
}): boolean {
  if ((rel.cardinality ?? "").includes("1対多")) return true;
  return /保有|所有|持つ/.test(rel.type ?? "");
}

/** 「子→親（所属）」を表すか（逆向きの関係から親子を補完する）。 */
function isBelonging(rel: { type?: string | null }): boolean {
  return /属する|所属/.test(rel.type ?? "");
}

/** ナビゲーション → 画面遷移図（flowchart）。
 * メインナビの各メニューを画面ノードとし、親子（階層）を遷移エッジに。
 * 一覧(list)系画面には詳細画面への遷移を補う。
 * さらに OOUI（モデリング）の関係を渡すと、1対多・保有/所属の関係を
 * 「親オブジェクトの詳細画面 → 子オブジェクトの一覧画面」の遷移として反映する。
 */
export function navigationToScreenFlow(
  nav: NavForFlow[],
  objects?: OouiForDiagram[] | null,
): string {
  if (!nav.length) return 'flowchart TD\n  none["（ナビ未設計）"]';
  const lines: string[] = ["flowchart TD"];
  const id = new Map<string, string>();
  nav.forEach((n, i) => id.set(n.label, `S${i}`));
  nav.forEach((n, i) => {
    lines.push(`  S${i}["${label(`${n.icon ? `${n.icon} ` : ""}${n.label}`)}"]`);
  });
  nav.forEach((n, i) => {
    const p = n.parent ? id.get(n.parent) : undefined;
    if (p) lines.push(`  ${p} --> S${i}`);
  });
  // 一覧画面 → 詳細画面。詳細ノードは OOUI 関係の遷移元にも使う。
  const detailId = new Map<number, string>();
  nav.forEach((n, i) => {
    if ((n.screenType ?? "").toLowerCase().includes("list")) {
      lines.push(`  D${i}["${label(n.label)}詳細"]`);
      lines.push(`  S${i} --> D${i}`);
      detailId.set(i, `D${i}`);
    }
  });

  // モデリングの親子関係（1対多・保有/所属）を画面遷移に反映する。
  // 例: 顧客 1対多 案件 → 「顧客詳細 -.-> 案件」。ナビ項目は targetObject
  // （無ければ label）で OOUI オブジェクトと照合する。
  if (objects?.length) {
    const navIndexByObject = new Map<string, number>();
    nav.forEach((n, i) => {
      const key = (n.targetObject ?? "").trim() || n.label.trim();
      if (key && !navIndexByObject.has(key)) navIndexByObject.set(key, i);
    });
    const seen = new Set<string>();
    const pushEdge = (parentIdx: number, childIdx: number, relType?: string | null) => {
      if (parentIdx === childIdx) return;
      const src = detailId.get(parentIdx) ?? `S${parentIdx}`;
      const key = `${src}->S${childIdx}`;
      if (seen.has(key)) return;
      seen.add(key);
      const t = relType ? label(relType).replace(/[:|]/g, "") : "";
      lines.push(`  ${src} -.->${t ? `|${t}|` : ""} S${childIdx}`);
    };
    for (const o of objects) {
      // 一覧（コレクション）オブジェクト自体は list 画面と等価なので対象外
      if (o.collectionOf) continue;
      const self = navIndexByObject.get(o.name.trim());
      if (self === undefined) continue;
      for (const rel of o.relations ?? []) {
        const other = navIndexByObject.get(rel.to.trim());
        if (other === undefined) continue;
        if (isContainment(rel)) pushEdge(self, other, rel.type);
        else if (isBelonging(rel)) pushEdge(other, self, rel.type);
      }
    }
  }
  return lines.join("\n");
}

/** 長いユースケース名を図向けに短縮 */
function truncate(raw: string, max = 28): string {
  const s = label(raw);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * アクター・ユースケース → flowchart。
 * アクターごとに subgraph でユースケースをグルーピングし、どのアクターが
 * どのユースケースを担うかを枠の包含関係で一目で分かるようにする。
 */
export function analysisToFlowchart(
  actors: ActorForDiagram[],
  useCases: UseCaseForDiagram[],
): string {
  const actorIds = new Map<string, string>();
  actors.forEach((a, i) => actorIds.set(a.name, `A${i}`));

  // ユースケースをアクター別に振り分け（該当アクター不明なものは「その他」へ）
  const byActor = new Map<string, { uid: string; goal: string }[]>();
  const orphans: { uid: string; goal: string }[] = [];
  useCases.forEach((u, i) => {
    const entry = { uid: `U${i}`, goal: u.goal };
    if (u.actorName && actorIds.has(u.actorName)) {
      const arr = byActor.get(u.actorName) ?? [];
      arr.push(entry);
      byActor.set(u.actorName, arr);
    } else {
      orphans.push(entry);
    }
  });

  const lines: string[] = ["flowchart LR"];
  actors.forEach((a) => {
    const aid = actorIds.get(a.name) ?? "A";
    lines.push(`  subgraph ${aid}["👤 ${label(a.name)}"]`);
    const ucs = byActor.get(a.name) ?? [];
    if (ucs.length === 0) {
      lines.push(`    ${aid}_e[" "]`); // 空グループのプレースホルダ
    }
    for (const uc of ucs) {
      lines.push(`    ${uc.uid}["${truncate(uc.goal)}"]`);
    }
    lines.push(`  end`);
  });
  if (orphans.length) {
    lines.push(`  subgraph OTHER["その他"]`);
    for (const uc of orphans) {
      lines.push(`    ${uc.uid}["${truncate(uc.goal)}"]`);
    }
    lines.push(`  end`);
  }
  return lines.join("\n");
}

/** period 文字列（「1ヶ月後」「3週間」「Q2」等）から概算の所要日数を推定する */
function periodToDays(period: string): number {
  const p = period ?? "";
  const num = (re: RegExp) => {
    const m = re.exec(p);
    return m ? Number(m[1]) : null;
  };
  const months = num(/(\d+)\s*(?:ヶ月|カ月|か月|ヵ月|month)/i);
  if (months) return months * 30;
  const weeks = num(/(\d+)\s*(?:週|week)/i);
  if (weeks) return weeks * 7;
  const days = num(/(\d+)\s*(?:日|day)/i);
  if (days) return days;
  if (/年|year/i.test(p)) return 365;
  if (/Q[1-4]|四半期|quarter/i.test(p)) return 90;
  return 30; // 既定 1ヶ月
}

/**
 * グロース計画のマイルストーンを mermaid gantt（ガントチャート）に変換する。
 * period から期間を推定し、各マイルストーンを順次（after 連結）で並べる。
 */
export function growthToSchedule(
  milestones?: { period: string; target: string }[] | null,
): string | null {
  if (!milestones?.length) return null;
  // タスク名は ":" / "," を含められない（gantt 構文の区切り）
  const esc = (s: string) =>
    (s ?? "").replace(/[:,]/g, "・").replace(/\n/g, " ").trim();
  const lines = [
    "gantt",
    "  title グロース・スケジュール",
    "  dateFormat YYYY-MM-DD",
    "  axisFormat %m/%d",
    "  section スケジュール",
  ];
  let prevId = "";
  milestones.forEach((m, i) => {
    const id = `m${i}`;
    const dur = periodToDays(m.period);
    const label =
      esc([m.period, m.target].filter(Boolean).join(" ")) || `工程${i + 1}`;
    const when = i === 0 ? "2026-01-01" : `after ${prevId}`;
    lines.push(`  ${label} :${id}, ${when}, ${dur}d`);
    prevId = id;
  });
  return lines.join("\n");
}
