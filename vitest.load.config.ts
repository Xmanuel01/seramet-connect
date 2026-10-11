import { defineConfig, mergeConfig } from "vitest/config";
import defaultConfig from "./vitest.config";

// Explicit load-only discovery: all seven suites, none in ordinary npm test.
export default mergeConfig(
  defaultConfig,
  defineConfig({
    test: {
      include: ["src/**/*-load.test.ts"],
      exclude: [],
    },
  }),
);
