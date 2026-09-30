import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside React Server Components; tests run server code directly.
      "server-only": path.resolve(import.meta.dirname, "test/helpers/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    env: loadEnv(mode, process.cwd(), ""), // .env.local → GEMINI_API_KEY for the opt-in AI tests
    testTimeout: 20_000,
  },
}));
