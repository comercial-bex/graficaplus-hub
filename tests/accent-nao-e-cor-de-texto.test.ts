import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `accent` é cor de FUNDO, não de texto (20/10/2026).
 *
 * No tema claro `--accent` é #e6f7fa — o azul quase branco do hover. Oito lugares
 * pintavam TEXTO com ele e, sobre o card branco (1,1:1), o texto sumia: a margem
 * boa na calculadora e no item do orçamento, o "suficiente" do material, os links
 * de OS e de orçamento na ficha do cliente, o círculo de "aprovado" na página que
 * o CLIENTE abre, a dica de faixa de preço, o ícone dos filamentos e a borda das
 * mensagens da OS. Achado no laboratório da calculadora: "Margem líquida" sem
 * número embaixo.
 *
 * Agora: margem e "ok" em `success`; link e dica clicável em `link` (token novo
 * em styles.css, os dois temas); borda em `primary`.
 */

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.(tsx?|css)$/.test(n) ? [p] : [];
  });
}

const CSS = readFileSync("src/styles.css", "utf8");

/** O valor de um token num bloco do CSS (`:root {` ou `.dark {`). */
function token(bloco: string, nome: string): string {
  const inicio = CSS.indexOf(`${bloco} {`);
  const corpo = CSS.slice(inicio, CSS.indexOf("\n}", inicio));
  const m = corpo.match(new RegExp(`\\n\\s*--${nome}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`--${nome} não está em ${bloco}`);
  return m[1];
}

const luminancia = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const razao = (a: string, b: string) => {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

describe("accent não é cor de texto", () => {
  it("nenhuma tela pinta texto, ícone ou borda com accent puro", () => {
    const achados: string[] = [];
    for (const caminho of arquivos("src")) {
      if (caminho.endsWith(".css")) continue;
      readFileSync(caminho, "utf8")
        .split("\n")
        .forEach((linha, i) => {
          const t = linha.trim();
          if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
          // `text-accent-foreground` e `bg-accent` são legítimos; `text-accent` e `border-accent` puros, não.
          if (/\b(text|border|border-l|border-b|border-t|border-r)-accent(?![-\w])/.test(linha)) {
            achados.push(`${caminho}:${i + 1}: ${t.slice(0, 90)}`);
          }
        });
    }
    expect(achados, "use text-success (bom), text-link (link) ou border-primary").toEqual([]);
  });

  it("o fundo accent do tema claro é, de fato, ilegível como texto (o motivo da regra)", () => {
    expect(razao(token(":root", "accent"), token(":root", "card"))).toBeLessThan(1.5);
  });

  it.each([
    [":root", "card"],
    [":root", "background"],
    [".dark", "card"],
    [".dark", "background"],
  ])("link e success leem bem em %s sobre %s (AA, 4,5:1)", (bloco, fundo) => {
    const f = token(bloco, fundo);
    expect(razao(token(bloco, "link"), f), `link em ${bloco}`).toBeGreaterThanOrEqual(4.5);
    expect(razao(token(bloco, "success"), f), `success em ${bloco}`).toBeGreaterThanOrEqual(4.5);
  });

  it("o token de link é papel do tema: mora em styles.css e vira classe pelo @theme", () => {
    expect(CSS).toContain("--color-link: var(--link);");
  });

  it("os lugares achados usam as cores certas", () => {
    const ler = (p: string) => readFileSync(p, "utf8");
    expect(ler("src/routes/aprovar.$token.tsx")).toContain('"bg-success/15 text-success"');
    expect(ler("src/routes/_authenticated/clientes.$id.tsx").match(/text-link hover:underline/g)).toHaveLength(2);
    expect(ler("src/components/orcamento-material-check.tsx")).toContain("text-success whitespace-nowrap");
    const orc = ler("src/routes/_authenticated/orcamentos.$id.tsx");
    expect(orc).toContain('<strong className={margem < 20 ? "text-destructive" : "text-success"}>');
    expect(orc).toContain('<span className="text-link">');
    expect(ler("src/routes/_authenticated/os.$id.tsx")).toContain("border-l-2 border-primary pl-3");
  });
});
