import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Orçamento 3D (a calculadora dentro do orçamento).
 *
 * 25/10/2026 (#222): impressora, filamento e presets viraram cartões de escolha.
 * 27/10/2026: o dono pediu pelo Lovable (plano "Impressora e filamento em
 * seleção compacta") que impressora e filamento voltassem a ser campos — lista
 * suspensa para a impressora; busca com paleta de cores para o filamento, que
 * passa de 40 — para liberar espaço na janela. Os presets continuam cartões.
 * O agente fez isso em `seletores-3d.tsx`; este teste, que cobrava os cartões,
 * passou a cobrar o que a troca NÃO podia mudar: escolher grava nos mesmos
 * campos do cálculo, o custo só aparece para quem pode ver custo, e cada campo
 * tem nome acessível (o nome da cor é dica + aria-label, não title).
 */

const TELA = readFileSync("src/components/impressao3d/calculadora-3d.tsx", "utf8");
const SELETORES = readFileSync("src/components/impressao3d/seletores-3d.tsx", "utf8");

/** O JSX de um seletor na calculadora: do `<Tag` ao `/>` que o fecha. */
function uso(tag: "SeletorImpressora" | "SeletorFilamento"): string {
  const ini = TELA.indexOf(`<${tag}`);
  expect(ini, tag).toBeGreaterThan(0);
  return TELA.slice(ini, TELA.indexOf("/>", ini));
}

describe("orçamento 3D: impressora e filamento em seleção compacta, presets em cartões", () => {
  it("impressora e filamento são os seletores compactos; presets continuam cartões", () => {
    expect(TELA).toContain("<SeletorImpressora");
    expect(TELA).toContain("<SeletorFilamento");
    expect(TELA).not.toContain('rotulo="Impressora"');
    expect(TELA).not.toContain('rotulo="Filamento"');
    expect(TELA).toContain('rotulo="Presets de custo"');
  });

  it("a impressora é lista suspensa; o filamento tem busca e a paleta de cores que filtra", () => {
    expect(SELETORES).toMatch(/export function SeletorImpressora[\s\S]*<Select /);
    expect(SELETORES).toMatch(/export function SeletorFilamento[\s\S]*<CommandInput /);
    expect(SELETORES).toContain('aria-label="Filtrar por cor"');
    expect(SELETORES).toContain("amostraDaCor(");
  });

  it("cada campo tem nome acessível, e a cor é dica + aria-label, não title", () => {
    expect(SELETORES).toContain('aria-label="Impressora"');
    expect(SELETORES).toContain('aria-label="Filamento"');
    expect(SELETORES).toContain("<Dica key={a.chave} texto={a.nome}>");
    expect(SELETORES).toContain("aria-label={`Cor ${a.nome}`}");
    expect(SELETORES).not.toMatch(/\stitle=/);
  });

  it("escolher continua gravando nos mesmos campos do cálculo", () => {
    expect(uso("SeletorImpressora")).toContain('onChange={(id) => set("maquina_id", id)}');
    expect(uso("SeletorFilamento")).toContain('onChange={(id) => set("material_id", id)}');
    expect(TELA).toContain("aplicarPreset(p.patch)");
  });

  it("o custo só aparece para quem pode ver custo — e quem decide é a calculadora, não o seletor", () => {
    expect(TELA).toContain("podeVerCusto");
    expect(uso("SeletorImpressora")).toContain("podeVerCusto");
    expect(uso("SeletorFilamento")).toContain("podeVerCusto");
    // O seletor desenha o `detalhe` que recebe; não lê custo nem formata dinheiro por conta própria.
    expect(SELETORES).not.toMatch(/custo_hora_calculado|custo_por_grama_calculado|money\(/);
  });

  it("o preset guardado da última vez volta marcado", () => {
    expect(TELA).toContain("setPresetAtivo(p.id)");
    expect(TELA).toContain("ativo={presetAtivo === p.id}");
  });

  it("os três blocos numerados e o resultado ao vivo continuam", () => {
    for (const t of ["Identificação", "Dados do fatiador", "Parâmetros de custo"])
      expect(TELA).toContain(`titulo="${t}"`);
  });
});
