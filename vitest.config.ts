import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Integration tests TRUNCATE all tables, so they only ever use TEST_DATABASE_URL
// (from the shell/CI or from .env), never the dev DATABASE_URL.
const testDbUrl = process.env.TEST_DATABASE_URL ?? loadEnv("test", process.cwd(), "").TEST_DATABASE_URL;

export default defineConfig({
  resolve: { tsconfigPaths: true }, // "@/..." imports, same as Next.js
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { DATABASE_URL: testDbUrl ?? "" },
    // Ledger tests share one database; run files one after another.
    fileParallelism: false,
  },
});
