import { describe, expect, it } from "vitest";
import { lucroPorUnidade, margemSobreVenda, posicaoNoMercado, precoDoParceiro } from "../src/domain/precos/tabela-de-precos";

describe("tabela de preços", () => {
  it("preço do parceiro: cadastro do produto ganha do desconto do nível", () => {
    expect(precoDoParceiro({ precoParceiro: 35, precoBase: 70, descontoDoNivelPct: 15 })).toEqual({ valor: 35, origem: "cadastro" });
    expect(precoDoParceiro({ precoParceiro: null, precoBase: 70, descontoDoNivelPct: 15 })).toEqual({ valor: 59.5, origem: "nivel" });
    expect(precoDoParceiro({ precoParceiro: null, precoBase: null, descontoDoNivelPct: 15 })).toBeNull();
  });
  it("lucro e margem são sobre a venda", () => {
    expect(lucroPorUnidade(70, 40)).toBe(30);
    expect(margemSobreVenda(70, 40)).toBe(42.9);
    expect(margemSobreVenda(0, 10)).toBeNull();
    expect(margemSobreVenda(null, 10)).toBeNull();
    expect(margemSobreVenda(35, 40)).toBe(-14.3);
  });
  it("posição contra concorrentes: menor e média, ignora preço inválido", () => {
    const p = posicaoNoMercado(70, [60, 80, 0, NaN]);
    expect(p).toEqual({ menor: 60, media: 70, contraOMenorPct: 16.7, contraAMediaPct: 0 });
    expect(posicaoNoMercado(70, [])).toBeNull();
  });
});
