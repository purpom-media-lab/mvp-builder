import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 親ディレクトリの lockfile を誤検出しないよう、このプロジェクトをルートに固定
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
