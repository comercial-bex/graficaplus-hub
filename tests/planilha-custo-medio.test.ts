import { describe, expect, it } from "vitest";
import {
  CUSTO_MEDIO_E_SOMENTE_LEITURA,
  custoVigenteDoMaterial,
  decidirCampo,
  textoDaFonteDoCusto,
  ultimaCompraNaoValeNasContas,
} from "@/domain/custos/campo-de-custo";

describe("custo vigente do material", () => {
  it("usa o médio quando existe, mesmo com última compra diferente", () => {
    expect(custoVigenteDoMaterial({ custo_medio: 8, custo_unitario: 10 })).toEqual({
      valor: 8,
      origem: "medio",
    });
  });
  it("cai na última compra quando o médio é nulo", () => {
    expect(custoVigenteDoMaterial({ custo_medio: null, custo_unitario: "10.5" })).toEqual({
      valor: 10.5,
      origem: "ultima_compra",
    });
  });
  it("médio zero vale zero, como o COALESCE do banco, e aparece sem custo", () => {
    expect(custoVigenteDoMaterial({ custo_medio: 0, custo_unitario: 0 })).toEqual({
      valor: 0,
      origem: "nenhum",
    });
  });
  it("sem nenhum dos dois é sem custo", () => {
    expect(custoVigenteDoMaterial({})).toEqual({ valor: 0, origem: "nenhum" });
  });
  it("textos curtos da fonte", () => {
    expect(textoDaFonteDoCusto("medio")).toBe("médio");
    expect(textoDaFonteDoCusto("ultima_compra")).toBe("última compra");
    expect(textoDaFonteDoCusto("nenhum")).toBe("sem custo");
  });
  it("última compra de material com médio não vale nas contas", () => {
    expect(ultimaCompraNaoValeNasContas({ custo_medio: 5, custo_unitario: 6 })).toBe(true);
    expect(ultimaCompraNaoValeNasContas({ custo_medio: null, custo_unitario: 6 })).toBe(false);
  });
  it("médio é só leitura por causa do gatilho de recálculo na compra", () => {
    expect(CUSTO_MEDIO_E_SOMENTE_LEITURA).toBe(true);
  });
});

describe("edição da última compra", () => {
  it("campo vazio não grava zero", () => {
    expect(decidirCampo("", 10)).toEqual({ acao: "manter" });
    expect(decidirCampo("  ", null)).toEqual({ acao: "manter" });
  });
  it("zero digitado grava", () => {
    expect(decidirCampo("0", 10)).toEqual({ acao: "gravar", valor: 0 });
  });
  it("ilegível e negativo são recusados", () => {
    expect(decidirCampo("abc", 10).acao).toBe("recusar");
    expect(decidirCampo("-1", 10).acao).toBe("recusar");
  });
  it("valor igual ao atual não grava", () => {
    expect(decidirCampo("9,5", 9.5)).toEqual({ acao: "manter" });
  });
});
