import { describe, expect, it } from "vitest";
import {
  descreverLinhaDeMetragem,
  metragemPorMaterial,
  totaisDaMetragem,
} from "../src/domain/orcamentos/metragem-por-material";

const produtos = [
  { id: "p-lona", nome: "Lona 280g impressa", material_principal_id: "m-lona", material_nome: "Lona 280g" },
  { id: "p-adesivo", nome: "Adesivo vinil branco", material_principal_id: "m-vinil", material_nome: "Vinil branco" },
  { id: "p-sem-material", nome: "Chaveiro acrílico", material_principal_id: null, material_nome: null },
];

describe("metragem por material", () => {
  it("soma a área COBRADA por material e conta as peças", () => {
    const linhas = metragemPorMaterial(
      [
        { id: "1", descricao: "Lona fachada", quantidade: 1, area_total: 2.1, area_cobrada: 2.1, produto_id: "p-lona" },
        { id: "2", descricao: "Lona pequena", quantidade: 2, area_total: 0.3, area_cobrada: 0.5, produto_id: "p-lona" },
        { id: "3", descricao: "Adesivo", quantidade: 10, area_total: 1.5, area_cobrada: 1.5, produto_id: "p-adesivo" },
      ],
      produtos,
    );
    expect(linhas.map((l) => [l.material, l.m2, l.pecas])).toEqual([
      ["Lona 280g", 2.6, 3],
      ["Vinil branco", 1.5, 10],
    ]);
  });

  it("item sem medida conta por unidade, com o nome do produto (ou do item) como material", () => {
    const linhas = metragemPorMaterial(
      [
        { id: "1", descricao: "Chaveiro", quantidade: 50, produto_id: "p-sem-material", unidade: "un" },
        { id: "2", descricao: "Instalação", quantidade: 1, produto_id: null, unidade: "un" },
      ],
      produtos,
    );
    expect(linhas.map((l) => [l.material, l.m2, l.pecas])).toEqual([
      ["Chaveiro acrílico", 0, 50],
      ["Instalação", 0, 1],
    ]);
    expect(descreverLinhaDeMetragem(linhas[0])).toBe("50 un");
  });

  it("a taxa de prazo fica de fora", () => {
    const linhas = metragemPorMaterial(
      [{ id: "t", descricao: "Expresso", quantidade: 1, origem_calculo: "taxa_prazo" }],
      produtos,
    );
    expect(linhas).toEqual([]);
  });

  it("peça 3D soma gramas de filamento por impressão (modelo + suporte + purga × placas)", () => {
    const linhas = metragemPorMaterial(
      [{ id: "i3d", descricao: "Chaveiro Mario", quantidade: 5, origem_calculo: "orcamento_3d", unidade: "un" }],
      produtos,
      [{ item_id: "i3d", material_descricao: "PLA · cor Azul", gramas_modelo: 10, peso_suporte_g: 1, peso_purga_g: 0.5, pecas_por_placa: 2, quantidade: 5 }],
    );
    // 5 peças, 2 por placa → 3 impressões × 11,5 g
    expect(linhas).toEqual([{ material: "PLA · cor Azul (3D)", m2: 0, pecas: 5, gramas: 34.5, itens: 1 }]);
    expect(descreverLinhaDeMetragem(linhas[0])).toBe("35 g · 5 peças");
  });

  it("os totais somam m² e gramas de todas as linhas", () => {
    const linhas = metragemPorMaterial(
      [
        { id: "1", descricao: "Lona", quantidade: 1, area_cobrada: 2, produto_id: "p-lona" },
        { id: "2", descricao: "Peça", quantidade: 1, origem_calculo: "orcamento_3d" },
      ],
      produtos,
      [{ item_id: "2", material_descricao: "PLA", gramas_modelo: 20, pecas_por_placa: 1, quantidade: 1 }],
    );
    expect(totaisDaMetragem(linhas)).toEqual({ m2: 2, gramas: 20 });
    expect(descreverLinhaDeMetragem(linhas[0])).toBe("2 m² · 1 peça");
  });
});
