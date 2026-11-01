import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { SectionHeader, trilhaDaTela } from "../src/components/bex/SectionHeader";

/**
 * Casca do sistema no desenho do Holdprint (31/10/2026), Onda 2 do plano
 * `docs/plano-interface-holdprint-31-10-2026.md`: topo azul-marinho, cabeçalho de
 * página com a trilha "Home / Área / Tela" e fundo liso (sem os pontos).
 */

const CSS = readFileSync("src/styles.css", "utf8");
const ROTA = readFileSync("src/routes/_authenticated/route.tsx", "utf8");

function token(bloco: string, nome: string): string {
  const inicio = CSS.indexOf(`${bloco} {`);
  const corpo = CSS.slice(inicio, CSS.indexOf("\n}", inicio));
  const m = corpo.match(new RegExp(`\\n\\s*--${nome}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`--${nome} não está em ${bloco}`);
  return m[1].toLowerCase();
}
const canais = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminancia = (hex: string) => {
  const [r, g, b] = canais(hex).map((v) => v / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const razao = (a: string, b: string) => {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const mistura = (frente: string, fundo: string, alfa: number) => {
  const [f, g] = [canais(frente), canais(fundo)];
  return "#" + f.map((v, i) => Math.round(v * alfa + g[i] * (1 - alfa)).toString(16).padStart(2, "0")).join("");
};

describe("topo azul-marinho", () => {
  it("o topo tem as mesmas cores nos dois temas e o Tailwind enxerga os tokens", () => {
    expect(token(":root", "topbar")).toBe("#121f3b");
    expect(token(".dark", "topbar")).toBe(token(":root", "topbar"));
    expect(token(".dark", "topbar-foreground")).toBe(token(":root", "topbar-foreground"));
    expect(CSS).toContain("--color-topbar: var(--topbar);");
    expect(CSS).toContain("--color-topbar-foreground: var(--topbar-foreground);");
  });

  it("a letra do topo lê bem, inclusive nas opacidades que o topo usa (70 e 80%)", () => {
    const fundo = token(":root", "topbar");
    const letra = token(":root", "topbar-foreground");
    expect(razao(letra, fundo)).toBeGreaterThanOrEqual(7);
    for (const alfa of [0.7, 0.8]) {
      expect(razao(mistura(letra, fundo, alfa), fundo), `opacidade ${alfa}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(razao("#ffffff", fundo)).toBeGreaterThanOrEqual(7);
  });

  it("o cabeçalho da casca usa o topo, o botão de tema vai claro e o fundo é liso", () => {
    expect(ROTA).toContain("bg-topbar text-topbar-foreground");
    expect(ROTA).not.toContain("bg-card/90 backdrop-blur-xl");
    expect(ROTA).toContain("<ThemeToggle noTopo />");
    expect(ROTA).not.toContain("bex-grid");
  });
});

describe("cabeçalho da página com trilha", () => {
  it("trilha: Home, os degraus do breadcrumb e o título por último", () => {
    expect(trilhaDaTela("Contas a pagar", "Financeiro")).toEqual(["Home", "Financeiro", "Contas a pagar"]);
    expect(trilhaDaTela("Catálogo", "Print OS · Comercial · Catálogo de brindes")).toEqual([
      "Home",
      "Print OS",
      "Comercial",
      "Catálogo de brindes",
      "Catálogo",
    ]);
    expect(trilhaDaTela("Início")).toEqual(["Home", "Início"]);
  });

  const html = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(TooltipProvider, null, createElement(SectionHeader, { title: "Contas a pagar", ...props })));

  it("mostra o título grande, a trilha navegável por leitor de tela e marca a tela atual", () => {
    const h = html({ breadcrumb: "Financeiro", description: "Tudo que sai." });
    expect(h).toContain('aria-label="Onde você está"');
    expect(h).toContain("Home");
    expect(h).toContain("Financeiro");
    expect(h).toContain('aria-current="page"');
    expect(h).toContain("text-2xl font-extrabold");
    expect(h).toContain("Tudo que sai.");
  });

  it("vira um cartão branco e continua guardando 16rem para o título, com as ações descendo", () => {
    const h = html({ actions: createElement("button", null, "Nova conta") });
    expect(h).toContain("bg-card");
    expect(h).toContain("flex flex-wrap items-center justify-between");
    expect(h).toContain("min-w-0 flex-1 basis-64");
    expect(h).toContain("Nova conta");
  });
});
