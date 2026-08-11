import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" -> "src/*" path alias.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Keep discovery out of .next/ and dist/, which hold built copies of the tests.
    include: ["src/**/*.test.ts"],
  },
});
