import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Keep discovery out of .next/ and dist/, which hold built copies of the tests.
    include: ["src/**/*.test.ts"],
  },
});
