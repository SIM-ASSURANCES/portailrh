import { defineConfig } from "vitest/config";

// Tests unitaires du backend (logique pure, sans base de données).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
