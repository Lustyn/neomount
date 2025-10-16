import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 180000, // 3 minutes for DinD
    hookTimeout: 180000, // 3 minutes for DinD setup
    teardownTimeout: 60000,
    bail: 1, // Stop after first test failure
  },
});
