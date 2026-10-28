import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "text-summary", "html"],
      reportsDirectory: "coverage/ts",
      include: ["src/**/*.ts", "scripts/**/*.ts", "web/app.js"],
      exclude: ["src/shared/types.ts"],
      reportOnFailure: true,
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
