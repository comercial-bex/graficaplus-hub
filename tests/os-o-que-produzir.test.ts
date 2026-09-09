import { describe, expect, it } from "vitest";
import {
  areaEmTexto,
  descreverItem,
  medidaEmTexto,
  quantidadeEmTexto,
  resumoDaProducao,
} from "../src/domain/os/o-que-produzir";

describe("a medida como a gráfica fala", () => {
  it("junta largura e altura em metros", () => {
    expect(medidaEmTexto({ largura: 3, altura: 0.7 })).toBe("3,00 × 0,70 m");
  });

  it("sem as duas medidas não inventa dimensão", () => {
    expect(medidaEmTexto({ largura: 3 })).toBeNull();
    expect(medidaEmTexto({ largura: 0, altura: 2 })).toBeNull();
    expect(medidaEmTexto({})).toBeNull();
  });

  it("aceita string, que é como o numeric chega do PostgREST", () => {
    expect(medidaEmTexto({ largura: "1.20", altura: "0.80" })).toBe("1,20 × 0,80 m");
  });
});

describe("a quantidade só aparece quando informa algo", () => {
  it("uma peça não vira texto — toda OS tem pelo menos uma", () => {
    expect(quantidadeEmTexto({ quantidade: 1, unidade: "un" })).toBeNull();
  });

  it("mais de uma aparece com a unidade", () => {
    expect(quantidadeEmTexto({ quantidade: 50, unidade: "un" })).toBe("50 un");
    expect(quantidadeEmTexto({ quantidade: 2.5, unidade: "m" })).toBe("2,50 m");
  });

  it("sem unidade assume peça", () => {
    expect(quantidadeEmTexto({ quantidade: 4 })).toBe("4 un");
  });
});

describe("a linha do item", () => {
  it("diz o que se sabe, na ordem que se lê", () => {
    expect(
      descreverItem({ descricao: "Faixa banner", largura: 3, altura: 0.7, quantidade: 2 }),
    ).toBe("Faixa banner · 3,00 × 0,70 m · 2 un");
  });

  it("só a descrição, quando é só o que existe", () => {
    // O caso real da OS #44: item cadastrado, sem medida, quantidade 1.
    expect(descreverItem({ descricao: "Urna e Gatinho Anjo ", quantidade: 1, unidade: "un" })).toBe(
      "Urna e Gatinho Anjo",
    );
  });

  it("item sem nada não vira linha vazia", () => {
    expect(descreverItem({})).toBe("Item sem descrição");
  });
});

describe("o resumo do cartão", () => {
  it("fala do primeiro e conta o resto", () => {
    const r = resumoDaProducao([
      { descricao: "Banner", largura: 2, altura: 1 },
      { descricao: "Adesivo" },
      { descricao: "Placa" },
    ])!;
    expect(r.linha).toBe("Banner · 2,00 × 1,00 m");
    expect(r.extras).toBe(2);
  });

  it("soma a metragem de quem tem área", () => {
    const r = resumoDaProducao([
      { descricao: "A", area_total: "2.00" },
      { descricao: "B", area_total: "3.50" },
      { descricao: "C" },
    ])!;
    expect(r.areaTotal).toBeCloseTo(5.5, 2);
    expect(areaEmTexto(r.areaTotal)).toBe("5,50 m²");
  });

  it("nenhum item com área devolve null, não zero", () => {
    // Zero escreveria "0,00 m²" e afirmaria uma metragem que ninguém mediu.
    const r = resumoDaProducao([{ descricao: "A" }])!;
    expect(r.areaTotal).toBeNull();
    expect(areaEmTexto(r.areaTotal)).toBeNull();
  });

  it("OS sem itens não produz resumo", () => {
    expect(resumoDaProducao([])).toBeNull();
    expect(resumoDaProducao(null)).toBeNull();
  });
});
