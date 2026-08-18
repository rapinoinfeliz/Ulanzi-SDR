import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["protocol/test/**/*.test.ts", "controller/ulanzi-plugin/src/**/*.test.ts"],
    coverage: { reporter: ["text", "html"] }
  }
});

