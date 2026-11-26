import { describe, expect, it } from "vitest";
import { cotarTrofeuComABase } from "../src/domain/trofeus/cotacao";
import {
  LIMITES_SOB_MEDIDA,
  avisosDoSobMedida,
  conferirPecasSobMedida,
  linhasDoSobMedida,
  materiaisCompativeis,
  mesmaEspessuraDaChapa,
  type PecaSobMedida,
} from "../src/domain/trofeus/sob-medida";
import { PADRAO, baseDoBanco } from "./apoio/trofeus-banco";

/**
 * Cotar as peças de uma ficha sem modelo cadastrado (26/11/2026): a parte pura. O servidor está em
 * `tests/trofeus-sob-medida-no-servidor.test.ts`.
 *
 * A prova que importa é a EQUIVALÊNCIA: as peças de um modelo cadastrado, passadas pelo caminho sob medida na altura
 * dele, têm de dar exatamente o preço desse modelo. Se isso vale, o sob medida não é uma segunda conta: é a mesma.
 */

const ID = "11111111-1111-4111-8111-111111111111";

const peca = (mexer: Partial<PecaSobMedida> = {}): PecaSobMedida => ({
  nome: "Placa principal",
  materialId: ID,
  espessuraMm: 6,
  larguraCm: 20,
  alturaCm: 15,
  quantidade: 1,
  decoracao: "vinil_laminado",
  fatorDeForma: 1,
  materialPedido: null,
  ...mexer,
});

describe("conferir as peças", () => {
  it("uma peça boa passa", () => {
    expect(conferirPecasSobMedida([peca()])).toBeNull();
  });

  it("lista vazia e lista grande demais são recusadas com frase", () => {
    expect(conferirPecasSobMedida([])).toBe("Liste ao menos uma peça para cotar.");
    expect(conferirPecasSobMedida(Array.from({ length: LIMITES_SOB_MEDIDA.pecasMaximas + 1 }, () => peca()))).toMatch(/até 20 peças/);
  });

  it.each([
    ["sem nome", { nome: "   " }, /sem nome/],
    ["sem material", { materialId: "" }, /sem material/],
    ["sem espessura", { espessuraMm: 0 }, /sem espessura/],
    ["largura minúscula", { larguraCm: 0.1 }, /largura fora/],
    ["altura gigante", { alturaCm: 500 }, /altura fora/],
    ["largura que não é número", { larguraCm: Number.NaN }, /largura fora/],
    ["quantidade quebrada", { quantidade: 1.5 }, /quantidade inteira/],
    ["quantidade zero", { quantidade: 0 }, /quantidade inteira/],
    ["decoração que não existe", { decoracao: "dtf_uv" as never }, /decoração que o troféu não conhece/],
    ["fator de forma abaixo de 1", { fatorDeForma: 0.5 }, /fator de forma fora/],
    ["fator de forma acima de 3", { fatorDeForma: 4 }, /fator de forma fora/],
  ])("recusa peça %s, dizendo qual é a peça", (_nome, mexer, frase) => {
    const r = conferirPecasSobMedida([peca(), peca({ nome: "Base", ...mexer })]);
    expect(r).toMatch(frase);
    expect(r).toMatch(/A peça 2/);
  });
});

describe("o substituto tem de ser da MESMA espessura", () => {
  const cadastro = [
    { id: "a", nome: "ACRILICO PRETO VIRGEM 3MM", espessuraMm: 3, unidade: "m²" },
    { id: "b", nome: "ACRILICO CRISTAL VIRGEM 10MM", espessuraMm: 10, unidade: "m²" },
    { id: "c", nome: "ACRILICO BRANCO VIRGEM 10MM", espessuraMm: 10, unidade: "m²" },
    { id: "d", nome: "Vinil adesivo", espessuraMm: 10, unidade: "un" },
    { nome: "Sem id", espessuraMm: 10, unidade: "m²" },
    { id: "e", nome: "Sem espessura", espessuraMm: null, unidade: "m²" },
  ];

  it("a placa de 10 mm nunca é cotada com o preto de 3 mm", () => {
    const nomes = materiaisCompativeis(10, cadastro).map((m) => m.nome);
    expect(nomes).toEqual(["ACRILICO CRISTAL VIRGEM 10MM", "ACRILICO BRANCO VIRGEM 10MM"]);
    expect(nomes).not.toContain("ACRILICO PRETO VIRGEM 3MM");
  });

  it("só entram chapas (m²) com id e espessura conhecida", () => {
    expect(materiaisCompativeis(10, cadastro).some((m) => m.nome === "Vinil adesivo" || m.nome === "Sem id" || m.nome === "Sem espessura")).toBe(false);
  });

  it("sem espessura válida não há opção", () => {
    expect(materiaisCompativeis(0, cadastro)).toEqual([]);
    expect(materiaisCompativeis(Number.NaN, cadastro)).toEqual([]);
  });

  it("tolera só 0,05 mm de diferença", () => {
    expect(mesmaEspessuraDaChapa(3, 3.04)).toBe(true);
    expect(mesmaEspessuraDaChapa(3, 3.1)).toBe(false);
    expect(mesmaEspessuraDaChapa(3, null)).toBe(false);
  });
});

describe("o modelo de passagem", () => {
  const referencia = { altura_referencia_m: 0.18, minutos_de_mao_de_obra: 25, multiplicador_base: 3 };

  it("tem como altura de referência a altura pedida e leva as peças em metros, na ordem", () => {
    const { modelo, pecas } = linhasDoSobMedida([peca(), peca({ nome: "Base", larguraCm: 22, alturaCm: 5 })], 18, referencia);
    expect(modelo.altura_referencia_m).toBe(0.18);
    expect(modelo.linha).toBe("padrao");
    expect(modelo.provisorio).toBe(false);
    expect(pecas.map((p) => [p.ordem, p.nome, p.largura_m, p.altura_m])).toEqual([
      [1, "Placa principal", 0.2, 0.15],
      [2, "Base", 0.22, 0.05],
    ]);
  });

  it("a mão de obra da linha Padrão cresce na proporção da altura, e o multiplicador é o dela", () => {
    expect(linhasDoSobMedida([peca()], 18, referencia).modelo.minutos_de_mao_de_obra).toBe(25);
    expect(linhasDoSobMedida([peca()], 36, referencia).modelo.minutos_de_mao_de_obra).toBe(50);
    expect(linhasDoSobMedida([peca()], 28, referencia).modelo.minutos_de_mao_de_obra).toBeCloseTo((25 * 28) / 18, 3);
    expect(linhasDoSobMedida([peca()], 28, referencia).modelo.multiplicador_base).toBe(3);
  });

  it("não deixa o nome da peça entrar com espaços nas pontas", () => {
    expect(linhasDoSobMedida([peca({ nome: "  Base  " })], 18, referencia).pecas[0].nome).toBe("Base");
  });
});

describe("EQUIVALÊNCIA: as peças de um modelo cadastrado dão o preço do modelo", () => {
  /** As peças do modelo, em centímetros e com o material pelo id, como a tela as mandaria. */
  const pecasDoModelo = (escala: number): PecaSobMedida[] =>
    PADRAO.pecas.map((p) => ({
      nome: p.nome,
      materialId: p.materialId,
      espessuraMm: p.espessuraMm,
      larguraCm: Math.round(p.larguraM * 100 * escala * 10) / 10,
      alturaCm: Math.round(p.alturaM * 100 * escala * 10) / 10,
      quantidade: p.quantidade,
      decoracao: p.decoracao,
      fatorDeForma: p.fatorDeForma,
      materialPedido: null,
    }));

  function cotarPorPecas(alturaCm: number, escala: number, quantidade = 1) {
    const base = baseDoBanco(PADRAO);
    const { modelo, pecas } = linhasDoSobMedida(pecasDoModelo(escala), alturaCm, base.modelo);
    return cotarTrofeuComABase({ ...base, modelo, pecas }, { alturaCm, quantidade, urgente: false, arte: null });
  }
  const cotarOModelo = (alturaCm: number, quantidade = 1) =>
    cotarTrofeuComABase(baseDoBanco(PADRAO), { alturaCm, quantidade, urgente: false, arte: null });

  it("na altura de referência (18 cm): mesmo custo, mesmo preço, mesma margem", () => {
    const a = cotarPorPecas(18, 1).resultado;
    const b = cotarOModelo(18).resultado;
    expect(a.custoCheio).toBe(b.custoCheio);
    expect(a.custoDeProducao).toBe(b.custoDeProducao);
    expect(a.precoUnitario).toBe(b.precoUnitario);
    expect(a.margemLiquidaPct).toBe(b.margemLiquidaPct);
    expect(a.precoUnitario).toBe(85.9);
  });

  it("no dobro da altura, com as peças no dobro: o mesmo que o modelo escalado", () => {
    const a = cotarPorPecas(36, 2).resultado;
    const b = cotarOModelo(36).resultado;
    expect(a.custoCheio).toBe(b.custoCheio);
    expect(a.precoUnitario).toBe(b.precoUnitario);
  });

  it("com quantidade maior a escada de multiplicador é a mesma", () => {
    for (const quantidade of [1, 5, 20, 100]) {
      expect(cotarPorPecas(18, 1, quantidade).resultado.precoUnitario).toBe(cotarOModelo(18, quantidade).resultado.precoUnitario);
    }
  });

  it("material mais grosso e mais caro sobe o preço, como tem de ser", () => {
    const base = baseDoBanco(PADRAO);
    const fina = pecasDoModelo(1);
    const grossa = fina.map((p, i) => (i === 0 ? { ...p, espessuraMm: 6, materialId: "mat-cristal-6mm" } : p));
    const preco = (pecas: PecaSobMedida[]) => {
      const { modelo, pecas: linhas } = linhasDoSobMedida(pecas, 18, base.modelo);
      return cotarTrofeuComABase({ ...base, modelo, pecas: linhas }, { alturaCm: 18, quantidade: 1, urgente: false, arte: null }).resultado.precoUnitario;
    };
    expect(preco(grossa)).toBeGreaterThan(preco(fina));
  });
});

describe("os avisos", () => {
  const nomes: Record<string, string> = { a: "ACRILICO CRISTAL VIRGEM 10MM", b: "ACRILICO BRANCO VIRGEM 2MM" };
  const nomeDoMaterial = (id: string) => nomes[id] ?? null;

  it("sempre dizem que é sob medida e de onde vêm a mão de obra e o multiplicador", () => {
    const [primeiro] = avisosDoSobMedida([peca({ materialId: "a" })], nomeDoMaterial);
    expect(primeiro).toMatch(/sob medida/);
    expect(primeiro).toMatch(/linha Padrão/);
    expect(primeiro).not.toMatch(/multiplicador|margem/i);
  });

  it("peça com material trocado diz qual foi usado no lugar de qual, e que o preço é estimativa", () => {
    const avisos = avisosDoSobMedida(
      [peca({ nome: "Base", materialId: "a", materialPedido: "Acrílico preto brilhante" }), peca({ nome: "Placa", materialId: "b" })],
      nomeDoMaterial,
    );
    expect(avisos).toHaveLength(2);
    expect(avisos[1]).toContain('A peça "Base" foi cotada com ACRILICO CRISTAL VIRGEM 10MM no lugar de "Acrílico preto brilhante"');
    expect(avisos[1]).toMatch(/estimativa/);
    expect(avisos.join(" ")).not.toContain("Placa\" foi cotada");
  });

  it("não carregam dinheiro", () => {
    const avisos = avisosDoSobMedida([peca({ materialId: "a", materialPedido: "Prata" })], nomeDoMaterial);
    expect(avisos.join(" ")).not.toMatch(/R\$|custo de|multiplicador de/i);
  });

  it("não repetem o mesmo aviso", () => {
    const iguais = avisosDoSobMedida([peca({ nome: "Base", materialId: "a", materialPedido: "X" }), peca({ nome: "Base", materialId: "a", materialPedido: "X" })], nomeDoMaterial);
    expect(new Set(iguais).size).toBe(iguais.length);
  });
});
