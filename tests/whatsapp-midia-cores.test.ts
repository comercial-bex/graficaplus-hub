import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * As cores do cartão de documento, do tocador de voz e do visor (onda 1,
 * 12/11/2026). O cartão tem fundo próprio e vale sobre qualquer bolha, então o
 * contraste se confere contra o fundo do cartão, nos dois temas.
 */

const CSS = readFileSync("src/styles.css", "utf8");
const BLOCO = CSS.slice(CSS.indexOf("início MIDIA"), CSS.indexOf("fim MIDIA"));

function token(bloco: ":root" | ".dark", nome: string): string {
  const i = BLOCO.indexOf(`${bloco} {`);
  const corpo = BLOCO.slice(i, BLOCO.indexOf("\n}", i));
  const m = corpo.match(new RegExp(`--${nome}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`--${nome} não está em ${bloco}`);
  return m[1].toLowerCase();
}
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const razao = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe.each([":root", ".dark"] as const)("contraste do cartão, tema %s", (tema) => {
  const t = (n: string) => token(tema, n);

  it("texto e apoio no fundo do cartão passam de 4,5:1", () => {
    expect(razao(t("midia-cartao-texto"), t("midia-cartao"))).toBeGreaterThanOrEqual(4.5);
    expect(razao(t("midia-cartao-apoio"), t("midia-cartao"))).toBeGreaterThanOrEqual(4.5);
  });

  it("o botão (texto no fundo do botão, e o hover) passa de 4,5:1", () => {
    expect(razao(t("midia-botao-texto"), t("midia-botao"))).toBeGreaterThanOrEqual(4.5);
    expect(razao(t("midia-botao-texto"), t("midia-botao-hover"))).toBeGreaterThanOrEqual(4.5);
  });

  it("o ponteiro e o trilho da barra se veem no cartão (3:1, o mínimo para forma)", () => {
    expect(razao(t("midia-ponteiro"), t("midia-cartao"))).toBeGreaterThanOrEqual(3);
    expect(razao(t("midia-trilho"), t("midia-cartao"))).toBeGreaterThanOrEqual(3);
  });

  it("a letra da ficha de cada tipo de arquivo passa de 4,5:1", () => {
    for (const tipo of ["pdf", "word", "planilha", "apresentacao", "compactado", "projeto", "outro"]) {
      expect(razao(t("midia-ficha-texto"), t(`midia-ficha-${tipo}`)), tipo).toBeGreaterThanOrEqual(4.5);
    }
  });
});
