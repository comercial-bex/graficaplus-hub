import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Carregando } from "../src/components/bex/Carregando";

/**
 * Animações discretas e desempenho (21/10/2026, decisão do dono: o visual que
 * o Bex já tem, animações discretas — até 0,2 s, desligadas para quem pede
 * menos movimento). A base já existia (tw-animate-css, janelas com fade e
 * zoom, regra de reduced-motion); aqui o que faltava.
 */

const ler = (p: string) => readFileSync(p, "utf8");
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

describe("desempenho: a próxima tela já está baixando", () => {
  it("o código da tela é pré-carregado ao passar o mouse ou encostar o dedo no link", () => {
    expect(ler("src/router.tsx")).toContain('defaultPreload: "intent"');
    // Os dados seguem com o React Query: o preload não guarda cópia velha.
    expect(ler("src/router.tsx")).toContain("defaultPreloadStaleTime: 0");
  });
});

describe("troca de tela", () => {
  it("transição nativa só quando o CAMINHO muda (abrir conversa e filtrar não esmaecem a tela)", () => {
    const r = ler("src/router.tsx");
    expect(r).toContain("defaultViewTransition: {");
    expect(r).toContain('types: ({ pathChanged }) => (pathChanged ? ["troca-de-tela"] : false)');
  });

  it("curta (160 ms) e desligada para quem pede menos movimento", () => {
    const css = ler("src/styles.css");
    expect(css).toMatch(/::view-transition-old\(root\),\s*::view-transition-new\(root\)\s*\{\s*animation-duration: 160ms;/);
    const reduzido = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduzido).toContain("::view-transition-group(*)");
    expect(reduzido).toContain("animation: none !important;");
  });
});

describe("retorno visual", () => {
  it("botão afunda de leve ao toque", () => {
    expect(ler("src/components/ui/button.tsx")).toContain("active:scale-[0.98]");
  });

  it("o fundo das janelas é mais leve (60%), em todas", () => {
    for (const p of ["dialog", "alert-dialog", "sheet", "drawer"]) {
      const s = ler(`src/components/ui/${p}.tsx`);
      expect(s, p).toContain("bg-black/60");
      expect(s, p).not.toContain("bg-black/80");
    }
  });

  it("abas esmaecem ao trocar, detalhes deslizam ao abrir", () => {
    expect(ler("src/components/ui/tabs.tsx")).toContain("data-[state=active]:animate-in data-[state=active]:fade-in-0");
    expect(ler("src/components/ui/collapsible.tsx")).toContain(
      "data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up",
    );
  });
});

describe("carregando com a forma do conteúdo", () => {
  it("esqueleto com aviso para o leitor de tela; a tela inteira ganha cabeçalho e blocos", () => {
    const lista = renderToStaticMarkup(createElement(Carregando));
    expect(lista).toContain('role="status"');
    expect(lista).toContain('<span class="sr-only">Carregando…</span>');
    expect(lista.match(/animate-pulse/g)).toHaveLength(3);
    const tela = renderToStaticMarkup(createElement(Carregando, { tela: true }));
    expect(tela.match(/animate-pulse/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("nenhum bloco volta a ser só a palavra 'Carregando...'", () => {
    const achados: string[] = [];
    for (const f of arquivos("src")) {
      if (f.endsWith("route.tsx")) continue; // a porta de entrada (sessão) segue em texto
      ler(f).split("\n").forEach((l, i) => {
        if (/<(div|p|CardContent) className="[^"]*">Carregando(\.\.\.|…)<\/(div|p|CardContent)>/.test(l)) achados.push(`${f}:${i + 1}`);
      });
    }
    expect(achados, "use <Carregando /> de src/components/bex/Carregando.tsx").toEqual([]);
  });
});
