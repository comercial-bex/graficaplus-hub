import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Tema claro com cor e letra legível (31/10/2026), Onda 1 do plano
 * `docs/plano-interface-holdprint-31-10-2026.md`.
 *
 * O dono enxerga mal. O sistema tinha letra de 10 a 12 px em mais de 1.400
 * lugares e menu de 13 px sobre um fundo quase preto. O Holdprint, que ele
 * aprovou, usa fundo cinza-azulado (#f2f4f7) e menu escuro da marca (#151f39, desde 02/11/2026) e
 * letra maior. Aqui ficam travadas as medidas que importam:
 *
 * - nenhuma letra fixa abaixo de 12 px, e a escala xs = 13 px, sm = 15 px;
 * - texto que antes usava a cor principal usa `text-link` (a principal virou
 *   verde-água, que some no branco: 2,3:1);
 * - contraste calculado de cada par de cor que carrega texto (4,5:1 ou mais);
 * - a barra lateral é igual nos dois temas (regra do AGENTS.md).
 */

const CSS = readFileSync("src/styles.css", "utf8");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.tsx$/.test(n) ? [p] : [];
  });
}

/** O valor de um token de cor (#rrggbb) num bloco do CSS (`:root {` ou `.dark {`). */
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
/** A cor `frente` com opacidade `alfa` sobre `fundo` (o que `text-x/55` desenha). */
const mistura = (frente: string, fundo: string, alfa: number) => {
  const [f, g] = [canais(frente), canais(fundo)];
  return "#" + f.map((v, i) => Math.round(v * alfa + g[i] * (1 - alfa)).toString(16).padStart(2, "0")).join("");
};

describe("nenhuma letra pequena demais", () => {
  it("nenhuma classe fixa em px abaixo de 12 px nem em rem abaixo de 0,75", () => {
    const achados: string[] = [];
    for (const caminho of arquivos("src")) {
      readFileSync(caminho, "utf8")
        .split("\n")
        .forEach((linha, i) => {
          for (const m of linha.matchAll(/text-\[(\d+(?:\.\d+)?)(px|rem)\]/g)) {
            const px = m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16;
            if (px < 12) achados.push(`${caminho}:${i + 1}: ${m[0]}`);
          }
        });
    }
    expect(achados, "use text-xs (13 px) ou maior").toEqual([]);
  });

  it("a escala do tema: xs = 13 px, sm = 15 px, com altura de linha folgada", () => {
    expect(CSS).toMatch(/--text-xs:\s*0\.8125rem/);
    expect(CSS).toMatch(/--text-xs--line-height:\s*1\.25rem/);
    expect(CSS).toMatch(/--text-sm:\s*0\.9375rem/);
    expect(CSS).toMatch(/--text-sm--line-height:\s*1\.5rem/);
  });

  it("o item do menu lateral tem 16 px", () => {
    const menu = readFileSync("src/components/menu/menu-lateral.tsx", "utf8");
    expect(menu).not.toContain("text-[13px]");
    expect(menu).toMatch(/h-11 w-full items-center gap-3 rounded-lg px-3 text-base/);
  });
});

describe("a cor principal não é cor de texto", () => {
  it("nenhuma tela pinta texto com text-primary puro (usa text-link)", () => {
    const achados: string[] = [];
    for (const caminho of arquivos("src")) {
      readFileSync(caminho, "utf8")
        .split("\n")
        .forEach((linha, i) => {
          const t = linha.trim();
          if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
          if (/(?<![-\w])text-primary(?![-\w])/.test(linha)) achados.push(`${caminho}:${i + 1}: ${t.slice(0, 90)}`);
        });
    }
    expect(achados, "text-link tem 6:1 no branco; a cor principal (verde-água) tem 2,3:1").toEqual([]);
  });
});

describe("contraste do tema claro (calculado)", () => {
  const B = ":root";

  it("texto principal e secundário leem bem no fundo, no cartão e nas áreas apagadas", () => {
    for (const fundo of ["background", "card"]) {
      expect(razao(token(B, "foreground"), token(B, fundo)), `foreground em ${fundo}`).toBeGreaterThanOrEqual(7);
      expect(razao(token(B, "muted-foreground"), token(B, fundo)), `muted-foreground em ${fundo}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(razao(token(B, "muted-foreground"), token(B, "muted"))).toBeGreaterThanOrEqual(4.5);
    expect(razao(token(B, "secondary-foreground"), token(B, "secondary"))).toBeGreaterThanOrEqual(4.5);
  });

  it("a ação principal verde-água só leva letra azul-marinho (7:1), nunca branca", () => {
    expect(token(B, "primary")).toBe("#0ebfa6");
    expect(razao(token(B, "primary-foreground"), token(B, "primary"))).toBeGreaterThanOrEqual(7);
    expect(razao("#ffffff", token(B, "primary")), "o motivo da regra").toBeLessThan(3);
  });

  it("perigo, sucesso e link com a letra que o sistema usa", () => {
    expect(razao(token(B, "destructive-foreground"), token(B, "destructive"))).toBeGreaterThanOrEqual(4.5);
    expect(razao(token(B, "success-foreground"), token(B, "success"))).toBeGreaterThanOrEqual(4.5);
    for (const fundo of ["background", "card"]) {
      expect(razao(token(B, "link"), token(B, fundo)), `link em ${fundo}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("o foco do teclado aparece no fundo e no cartão (3:1, contraste de elemento)", () => {
    for (const fundo of ["background", "card"]) {
      expect(razao(token(B, "ring"), token(B, fundo)), `ring em ${fundo}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("o cartão branco se destaca do fundo cinza-azulado", () => {
    expect(token(B, "card")).toBe("#ffffff");
    expect(token(B, "background")).toBe("#f2f4f7");
    expect(razao(token(B, "card"), token(B, "background"))).toBeGreaterThan(1.1);
  });
});

describe("a barra lateral azul-marinho", () => {
  const nomes = [
    "sidebar",
    "sidebar-foreground",
    "sidebar-primary",
    "sidebar-primary-foreground",
    "sidebar-accent",
    "sidebar-accent-foreground",
    "sidebar-border",
    "sidebar-ring",
  ];

  it("é igual nos dois temas (a navegação mantém a identidade)", () => {
    for (const n of nomes) expect(token(".dark", n), n).toBe(token(":root", n));
  });

  it("é escura, da marca: painel quase preto azulado, trilho mais escuro e a pílula do ativo (02/11/2026)", () => {
    expect(token(":root", "sidebar")).toBe("#151f39");
    expect(token(":root", "sidebar-trilho")).toBe("#0f172e");
    expect(token(":root", "sidebar-accent")).toBe("#1f3550");
    // o neon ciano da marca fica só no ativo, na marca e nos selos
    expect(token(":root", "sidebar-marca")).toBe("#00d3f2");
  });

  it("a letra do menu lê bem inclusive nas opacidades que o menu usa (80, 75, 70 e 60%)", () => {
    const fundo = token(":root", "sidebar");
    const letra = token(":root", "sidebar-foreground");
    expect(razao(letra, fundo)).toBeGreaterThanOrEqual(7);
    for (const alfa of [0.8, 0.75, 0.7, 0.6]) {
      expect(razao(mistura(letra, fundo, alfa), fundo), `opacidade ${alfa}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(razao(token(":root", "sidebar-accent-foreground"), token(":root", "sidebar-accent"))).toBeGreaterThanOrEqual(7);
    expect(razao(token(":root", "sidebar-primary"), fundo)).toBeGreaterThanOrEqual(4.5);
  });
});
