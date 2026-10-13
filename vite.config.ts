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
    // Sem modo SPA (casca pré-renderizada): ligado e desligado em 13/10/2026.
    // A hospedagem do Lovable não serve a casca pré-renderizada — o HTML continua
    // gerado por rota no servidor — e o tempo até o primeiro byte já está no piso
    // da hospedagem (~0,45 s, igual ao de uma rota inexistente). Medição no PR #127.
  },
});
