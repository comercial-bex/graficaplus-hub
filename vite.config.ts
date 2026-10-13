// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Casca estática para toda página (13/10/2026). Medido no site publicado:
    // o servidor levava de 0,5 s a 2,4 s para devolver o HTML de cada tela,
    // antes de o navegador baixar qualquer coisa — e esse HTML era sempre
    // "Carregando...", porque a tela inteira é do cliente. Com o modo SPA o
    // Lovable serve a casca pré-renderizada da borda; as rotas de API (api.*)
    // e as funções de servidor continuam no servidor.
    spa: { enabled: true },
  },
});
