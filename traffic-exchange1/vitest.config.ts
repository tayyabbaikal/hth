import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    // Provide the secrets env.ts requires so the module loads under test.
    env: {
      DATABASE_URL: "postgresql://tx:tx@localhost:5432/tx_test?schema=public",
      AUTH_JWT_SECRET: "test-auth-secret-that-is-long-enough-1234",
      VISIT_TOKEN_SECRET: "test-visit-secret-that-is-long-enough-1234",
      IP_HASH_SALT: "test-salt-1234",
    },
  },
});
