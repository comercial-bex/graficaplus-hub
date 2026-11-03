import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/20261103600000_custo_real_do_acrilico_terzian.sql", "utf8");

// Preço da chapa ÷ área da chapa, arredondado em centavos: o mesmo cálculo da migração.
const porM2 = (chapa: number, largura: number, altura: number) =>
  Math.round((chapa / (largura * altura)) * 100) / 100;

describe("custo real do acrílico (orçamento da Terzian, 03/11/2026)", () => {
  it("o custo por m² sai do preço da chapa e da área dela", () => {
    expect(porM2(316.0, 1.03, 2.03)).toBe(151.13);
    expect(porM2(398.43, 1.03, 2.03)).toBe(190.55);
    expect(porM2(801.51, 1.03, 2.03)).toBe(383.33);
    expect(porM2(1282.49, 1.05, 2.05)).toBe(595.81);
  });

  it("a migração usa as mesmas chapas e referências da nota", () => {
    for (const trecho of [
      "316.00 / (1.03 * 2.03)",
      "398.43 / (1.03 * 2.03)",
      "801.51  / (1.03 * 2.03)",
      "1282.49 / (1.05 * 2.05)",
      "ref. Terzian 4172",
      "ref. Terzian 3772",
      "ref. Terzian 3774",
      "ref. Terzian 3717",
    ]) {
      expect(SQL).toContain(trecho);
    }
  });

  it("só troca o custo antigo e nunca sobrescreve um custo que alguém já corrigiu", () => {
    expect(SQL).toContain("nome = 'ACRILICO CRISTAL VIRGEM 2MM' AND custo_unitario = 300");
    expect(SQL).toContain("nome = 'ACRILICO CRISTAL VIRGEM 3MM' AND custo_unitario = 400");
    expect(SQL).toContain("WHERE NOT EXISTS (SELECT 1 FROM public.materiais m WHERE m.nome = v.nome)");
  });

  it("chapa não é rolo: sem largura_bobina_m, senão vira alerta vermelho de estoque cheio", () => {
    expect(SQL).not.toMatch(/INSERT INTO public\.materiais[^;]*largura_bobina_m/);
    expect(SQL).not.toMatch(/SET[^;]*largura_bobina_m/);
  });

  it("o Quadro Acrílico ganha receita (acrílico 3 mm + vinil) em vez de custo digitado", () => {
    expect(SQL).toContain("WHERE produto_id = v_quadro");
    expect(SQL).toContain("Acrílico cast cristal 3 mm: 1 m² por m² de quadro");
    expect(SQL).toContain("Vinil adesivo branco brilho");
  });

  it("não mexe em preço de venda, em estoque nem em lote", () => {
    expect(SQL).not.toMatch(/preco_base|preco_parceiro|preco_publico/);
    expect(SQL).not.toMatch(/UPDATE public\.materiais[^;]*estoque\s*=/);
    expect(SQL).not.toMatch(/material_lotes/);
  });
});
