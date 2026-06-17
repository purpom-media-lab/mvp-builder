import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js と同様に .env.local を優先して読み込む
config({ path: ".env.local" });
config();

export default defineConfig({
  schema: ["./src/lib/db/schema.ts", "./src/lib/db/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
