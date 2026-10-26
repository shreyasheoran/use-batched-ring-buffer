import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
