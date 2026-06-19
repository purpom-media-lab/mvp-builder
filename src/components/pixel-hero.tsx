"use client";

import { cn } from "@/lib/utils";

/**
 * 勇者が冒険するドット絵ローダー。
 * 剣を掲げた勇者が上下にバウンドしながら歩き、足元の地面が流れて“前進”を表現。
 * 星（ブランドの星座モチーフ）がきらめく。prefers-reduced-motion 尊重（globals.css 側）。
 */

// パレット
const P: Record<string, string> = {
  W: "#f3f1ea", // 兜・白
  R: "#d6312b", // 赤
  K: "#241c1c", // 黒に近い濃色
  O: "#e8920f", // 顔・肌/アーム
  B: "#8a5a2b", // 茶（髪・グリップ）
  G: "#9298a3", // 剣身グレー
  T: "#cdb892", // ブーツ
  L: "#1163c6", // 青（鎧）
};

// 上半身〜胴（静止）。'.' は透明。14列。
const BODY = [
  "......RWKK....",
  ".....WWWWKK...",
  "....BOBOOOKK..",
  "..W..OOOOOOK..",
  "..W..OOOOOO...",
  ".GGGG.OOOO..O.",
  "..W..OLLLLO.OO",
  "..B..LLRRLLOR.",
  "..B..LRRRRL.R.",
  ".....LLLLLLRR.",
  ".....LLLLLL...",
];

// 脚＋ブーツの2フレーム（歩行アニメ）。rows 11-13 相当。
const LEGS_A = [
  ".....LL..LL...",
  ".....LL..LL...",
  "....TT....TT..",
];
const LEGS_B = [
  ".....LL..LL...",
  "......LLLL....",
  ".....TT..TT...",
];

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

export function PixelHero({
  className,
  size = 64,
}: {
  className?: string;
  size?: number;
}) {
  const body = rowsToRects(BODY, 0);
  const legsA = rowsToRects(LEGS_A, BODY.length);
  const legsB = rowsToRects(LEGS_B, BODY.length);

  return (
    <div
      className={cn("pixel-hero", className)}
      aria-hidden
      style={{ width: size, height: Math.round((size * (ROWS + 2)) / COLS) }}
    >
      <svg
        viewBox={`0 0 ${COLS} ${ROWS + 2}`}
        width="100%"
        height="100%"
        shapeRendering="crispEdges"
      >
        {/* 地面（流れる破線） */}
        <g className="ph-ground">
          {Array.from({ length: 14 }).map((_, i) => (
            <rect
              key={`g${i}`}
              x={(i * 2) % (COLS + 4)}
              y={ROWS + 1}
              width={1}
              height={1}
              fill="#4f46e5"
              opacity={0.5}
            />
          ))}
        </g>
        {/* 勇者（バウンド） */}
        <g className="ph-hero">
          {body.map((p, i) => (
            <rect key={`b${i}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.c} />
          ))}
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
        <rect className="ph-star ph-star2" x={12} y={4} width={1} height={1} fill="#8b82f5" />
        <rect className="ph-star ph-star3" x={11} y={1} width={1} height={1} fill="#f3f1ea" />
      </svg>
    </div>
  );
}
