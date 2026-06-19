"use client";

import { cn } from "@/lib/utils";

/**
 * 勇者が冒険するドット絵ローダー。
 * 剣を掲げた勇者が、暗い夜空タイルの中をバウンドしながら歩く。
 * 足元の地面が流れて“前進”を、星のきらめきで冒険感を表現。
 * 暗いタイルに収めることで、明暗どちらのテーマでもくっきり読める。
 * prefers-reduced-motion はアニメ無効化（globals.css 側）。
 */

// パレット（'.' は透明）
const P: Record<string, string> = {
  W: "#eef0ee", // 兜・剣身の白
  R: "#d6312b", // 赤
  K: "#241c1c", // 黒に近い濃色（兜の影・髪）
  O: "#e8920f", // 顔・肌/アーム
  B: "#8a5a2b", // 茶（グリップ・髪）
  G: "#8d929b", // 剣の鍔グレー
  T: "#cdb892", // ブーツ
  L: "#1163c6", // 青（鎧）
};

// 上半身〜胴（静止）。14列。長い白刃を左に、鍔→グリップと続く。
const BODY = [
  "..W...RWKK....",
  "..W..WWWWKK...",
  "..W.BOBOOOKK..",
  "..W..OOOOOOK..",
  "..W..OOOOOO..O",
  ".GGGG.OOOO..OO",
  "..B..OLLLLO.OO",
  "..B..LLRRLLOR.",
  ".....LRRRRL.R.",
  ".....LLLLLLRR.",
  ".....LLLLLL...",
];

// 脚＋ブーツの2フレーム（歩行）
const LEGS_A = [
  ".....LL..LL...",
  ".....LL..LL...",
  ".....TT..TT...",
];
const LEGS_B = [
  ".....LL..LL...",
  "......LLLL....",
  ".....TT..TT...",
];

// 剣（刃・鍔・グリップ）のセル。歩行に合わせて振るため別グループにする。
const SWORD_CELLS = new Set([
  "2,0", "2,1", "2,2", "2,3", "2,4", // 刃
  "1,5", "2,5", "3,5", "4,5", // 鍔
  "2,6", "2,7", // グリップ
]);

function rowsToRects(rows: string[], yOffset: number) {
  const rects: { x: number; y: number; c: string }[] = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch !== "." && P[ch]) rects.push({ x: c, y: r + yOffset, c: P[ch] });
    }
  });
  return rects;
}

const COLS = 14;
const ROWS = BODY.length + LEGS_A.length; // 14
const VH = ROWS + 2; // 地面ぶん

export function PixelHero({
  className,
  size = 72,
}: {
  className?: string;
  /** タイルの高さ(px)。幅は少し広め。 */
  size?: number;
}) {
  const allBody = rowsToRects(BODY, 0);
  const sword = allBody.filter((p) => SWORD_CELLS.has(`${p.x},${p.y}`));
  const body = allBody.filter((p) => !SWORD_CELLS.has(`${p.x},${p.y}`));
  const legsA = rowsToRects(LEGS_A, BODY.length);
  const legsB = rowsToRects(LEGS_B, BODY.length);
  const svgH = size - 12;
  const svgW = Math.round((svgH * COLS) / VH);

  return (
    <div
      className={cn("pixel-hero", className)}
      aria-hidden
      style={{ width: Math.round(size * 1.06), height: size }}
    >
      <svg
        viewBox={`0 0 ${COLS} ${VH}`}
        width={svgW}
        height={svgH}
        shapeRendering="crispEdges"
      >
        {/* 流れる地面 */}
        <g className="ph-ground">
          {Array.from({ length: 14 }).map((_, i) => (
            <rect
              key={`g${i}`}
              x={(i * 2) % (COLS + 4)}
              y={VH - 1}
              width={1}
              height={1}
              fill="#6d63f0"
              opacity={0.7}
            />
          ))}
        </g>
        {/* 勇者（バウンド） */}
        <g className="ph-hero">
          {body.map((p, i) => (
            <rect key={`b${i}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.c} />
          ))}
          {/* 剣（歩行に合わせて振る） */}
          <g className="ph-sword">
            {sword.map((p, i) => (
              <rect key={`s${i}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.c} />
            ))}
          </g>
          <g className="ph-legA">
            {legsA.map((p, i) => (
              <rect key={`la${i}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.c} />
            ))}
          </g>
          <g className="ph-legB">
            {legsB.map((p, i) => (
              <rect key={`lb${i}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.c} />
            ))}
          </g>
        </g>
        {/* きらめく星 */}
        <rect className="ph-star ph-star1" x={1} y={2} width={1} height={1} fill="#f0a9d8" />
        <rect className="ph-star ph-star2" x={12} y={5} width={1} height={1} fill="#8b82f5" />
        <rect className="ph-star ph-star3" x={11} y={1} width={1} height={1} fill="#eef0ee" />
      </svg>
    </div>
  );
}
