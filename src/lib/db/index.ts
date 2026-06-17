/** Neon (serverless Postgres) + Drizzle クライアント */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";

const schema = { ...appSchema, ...authSchema };

// ビルド時（DATABASE_URL 未設定）でもモジュール読み込みで落ちないようフォールバック。
// 実接続は実行時に行われ、本番では環境変数が上書きする。
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@placeholder.neon.tech/placeholder";

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
export { schema };
