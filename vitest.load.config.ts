import { defineConfig } from "vitest/config";
import defaultConfig from "./vitest.config";

// Explicitly REPLACE rather than merge arrays; mergeConfig can retain the
// default exclude glob and silently skip all load tests.
export default defineConfig({
  ...defaultConfig,
  test: {
    ...defaultConfig.test,
    include: ["src/**/*-load.test.ts"],
    exclude: [],
  },
});
