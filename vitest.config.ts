import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Config próprio em vez de reaproveitar vite.config.ts: aquele carrega o preset
// do Lovable (tanstackStart, nitro, componentTagger), que é pesado e assume o
// sandbox. Os testes cobrem o domínio puro em src/domain, então só precisam do
// alias "@".
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
