import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  custoDaPecaPorArea,
  custoM2Implicito,
  precoM2Implicito,
  valorUnitarioComMinimo,
} from "../src/domain/orcamentos/area";

/**
 * A margem do item por área (20/10/2026).
 *
 * Medido no banco: três itens do orçamento #69 gravaram o custo do produto
 * POR M² como custo da PEÇA. A Placa PVC 3 mm de 0,30 × 0,15 a R$ 250/m² sai
 * por R$ 11,25 a peça; o custo gravado era R$ 78,00 (o do m²) — margem de
 * −593% na tela e R$ 1.950 de custo onde eram R$ 87,75. O banco já fazia a
 * conta certa (custo/m² × área) quando o item chegava sem custo; a tela, para
 * quem vê custo, copiava o do produto direto.
 *
 * E um irmão no mesmo caminho: editar um item que paga a área mínima voltava
 * o preço/m² dividido pela área REAL, e o banco multiplicava pelo mínimo —
 * o preço inflava a cada edição.
 */

const placa = { largura: 0.3, altura: 0.15, quantidade: 25 }; // 0,045 m²
const adesivo = { largura: 1.5, altura: 1, quantidade: 3 }; // 1,5 m²

describe("o custo da peça sai da mesma área que o preço", () => {
  it("os três itens do #69: custo/m² × área da peça", () => {
    expect(custoDaPecaPorArea(placa, 78)).toBe(3.51);
    expect(custoDaPecaPorArea({ largura: 0.5, altura: 0.5, quantidade: 6 }, 78)).toBe(19.5);
    expect(custoDaPecaPorArea(adesivo, 22)).toBe(33);
  });

  it("com área mínima, custo e preço usam o mínimo (o setup custa para a casa também)", () => {
    expect(custoDaPecaPorArea(placa, 78, 0.25)).toBe(19.5);
    expect(valorUnitarioComMinimo(placa, 250, 0.25)).toBe(62.5);
  });

  it("a margem da placa: era −593%, agora 68,8%", () => {
    const preco = valorUnitarioComMinimo(placa, 250);
    expect(preco).toBe(11.25);
    expect(Math.round(((preco - 78) / preco) * 1000) / 10).toBe(-593.3);
    const custo = custoDaPecaPorArea(placa, 78);
    expect(Math.round(((preco - custo) / preco) * 1000) / 10).toBe(68.8);
  });

  it("ida e volta: o custo/m² embutido, vezes a área, devolve o custo da peça ao centavo", () => {
    for (const [dims, peca, minimo] of [
      [placa, 3.51, null],
      [placa, 19.5, 0.25],
      [adesivo, 33, null],
      [{ largura: 0.33, altura: 0.47, quantidade: 1 }, 10, null],
      [{ largura: 1.234, altura: 0.777, quantidade: 1 }, 25.95, null],
    ] as const) {
      const m2 = custoM2Implicito(dims, peca, minimo);
      expect(m2).not.toBeNull();
      expect(custoDaPecaPorArea(dims, m2!, minimo), JSON.stringify(dims)).toBe(peca);
    }
  });
});

describe("editar um item com área mínima não infla o preço", () => {
  it("o preço/m² volta dividido pela área cobrada, e a volta dá o mesmo valor", () => {
    // 0,045 m² com mínimo de 0,25 m² a R$ 250/m² = R$ 62,50.
    const m2 = precoM2Implicito(placa, 62.5, 0.25);
    expect(m2).toBe(250);
    expect(valorUnitarioComMinimo(placa, m2!, 0.25)).toBe(62.5);
    // O erro antigo: dividir pela área real dava R$ 1.388,89/m² e R$ 347,22 na volta.
    const antigo = precoM2Implicito(placa, 62.5);
    expect(antigo).toBe(1388.89);
  });
});

describe("o formulário", () => {
  const F = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

  it("com medida, o campo é Custo/m² e o custo da peça é derivado", () => {
    expect(F).toContain('{custoPorArea ? "Custo/m²" : "Custo un."}');
    expect(F).toContain("custoDaPecaPorArea(dimensoesForm, paraNumero(form.custo_m2), form.area_minima)");
    expect(F).toContain("value={custoPorArea ? custoM2NoCampo : form.custo_unitario}");
  });

  it("produto por área traz o custo como custo/m²; editar e a calculadora voltam o custo/m² embutido", () => {
    expect(F).toContain('custo_m2: ehUnidadeDeArea(p.unidade) ? String(p.custo_medio ?? "") : "",');
    expect(F).toContain("custoM2Implicito(dims, Number(i.custo_unitario ?? 0), areaMinima)");
    expect(F).toContain("custoM2Implicito(dimensoesForm, daPeca, form.area_minima)");
    expect(F).toContain("precoM2Implicito(dims, Number(i.valor_unitario ?? 0), areaMinima)");
  });

  it("o banco recebe o custo da PEÇA (custo_m2 nunca vai ao banco)", () => {
    expect(F).toContain("campos.custo_unitario = custoUnitarioForm;");
    expect(F).toContain("custo_unitario: custoUnitarioForm,");
    const campos = F.slice(F.indexOf("const campos: Record<string, unknown> = {"), F.indexOf("setSalvandoItem(true);"));
    expect(campos).not.toContain("custo_m2");
  });

  it("a margem mostra a conta: preço e custo da mesma peça", () => {
    expect(F).toContain("· peça: {brl(valorUnitarioEfetivo)} de preço, {brl(custoUnitarioForm)} de custo");
  });
});
