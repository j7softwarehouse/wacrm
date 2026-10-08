import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
      // src/lib/i18n/locale.ts reads this at module load to drive
      // Intl/date-fns formatting (currency.ts, etc). Pin it so
      // locale-dependent assertions are deterministic across machines
      // instead of depending on whichever locale .env.local (unread by
      // vitest) or the host OS happens to default to.
      NEXT_PUBLIC_APP_LOCALE: "pt-BR",
    },
    clearMocks: true,
  },
});
