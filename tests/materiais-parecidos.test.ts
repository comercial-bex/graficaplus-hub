import { describe, expect, it } from "vitest";
import {
  candidatosParaIa,
  compararMateriais,
  contarPorUnidade,
  interpretarArgumentosDaIa,
  materiaisParecidos,
  montarPerguntaDaIa,
  normalizarTexto,
  normalizarUnidade,
  type MaterialComparavel,
} from "../src/domain/materiais/parecidos";

/**
 * Material parecido com um já cadastrado. A lista abaixo são os 21 materiais
 * reais do Bex Print em 05/10/2026 — os casos de teste são os que aconteceriam
 * de verdade no cadastro.
 */
const NOMES: [string, string][] = [
  ["ACRILICO BRANCO VIRGEM 3MM", "m²"],
  ["ACRILICO CRISTAL VIRGEM 3MM", "m²"],
  ["Acrilico esp dourado 2mm", "mt"],
  ["ACRILICO PRETO VIRGEM 3MM", "m²"],
  ["Bastão + corda para banner", "un"],
  ["Chapa ACM 3mm", "m2"],
  ["Chapa PS 2mm", "m2"],
  ["Chapa PVC expandido 3mm", "m2"],
  ["Ilhós metálico", "un"],
  ["Laminação polimérica", "m2"],
  ["Lona 280g brilho", "m2"],
  ["Lona 440g reforçada", "m2"],
  ["PLA 3DLAB", "g"],
  ["PLA 3DX Natural", "g"],
  ["PLA eSUN", "g"],
  ["PLA Macarrom Verde", "g"],
  ["PLA Voolt Matte", "g"],
  ["Tinta solvente (conjunto)", "ml"],
  ["Vinil adesivo branco brilho", "m2"],
  ["Vinil adesivo perfurado", "m2"],
  ["Vinil jateado", "m2"],
];
const LISTA: MaterialComparavel[] = NOMES.map(([nome, unidade], i) => ({ id: `m${i}`, nome, unidade }));

const primeiro = (nome: string, unidade = "m²") => materiaisParecidos({ nome, unidade }, LISTA)[0];

describe("unidade com uma grafia só", () => {
  it("m2, M², metro quadrado e mq são m²; und e peça são un", () => {
    for (const u of ["m2", "M2", "m²", "M²", "metro quadrado", "mq", "m 2"]) expect(normalizarUnidade(u), u).toBe("m²");
    for (const u of ["un", "UN", "und", "unidade", "peça", "pç"]) expect(normalizarUnidade(u), u).toBe("un");
    expect(normalizarUnidade("gr")).toBe("g");
    expect(normalizarUnidade("Kg")).toBe("kg");
    expect(normalizarUnidade("lt")).toBe("L");
    expect(normalizarUnidade("ml")).toBe("ml");
    expect(normalizarUnidade("mt")).toBe("m");
    expect(normalizarUnidade("rolo")).toBe("rolo");
    expect(normalizarUnidade(null)).toBe("un");
  });

  it("o filtro junta m2 e m² e sempre oferece m², un e kg", () => {
    const contagem = contarPorUnidade(LISTA);
    const porUnidade = Object.fromEntries(contagem.map((c) => [c.unidade, c.total]));
    expect(porUnidade["m²"]).toBe(12);
    expect(porUnidade.g).toBe(5);
    expect(porUnidade.un).toBe(2);
    expect(porUnidade.kg).toBe(0);
    expect(porUnidade.ml).toBe(1);
    expect(porUnidade.m).toBe(1);
    expect(contagem[0].unidade).toBe("m²");
    expect(contagem.reduce((s, c) => s + c.total, 0)).toBe(21);
  });
});

describe("texto comparável", () => {
  it("tira acento, caixa e pontuação, e cola o número na unidade", () => {
    expect(normalizarTexto("Lona 440 G Reforçada")).toBe("lona 440g reforcada");
    expect(normalizarTexto("Acrílico 2,5 mm")).toBe("acrilico 2.5mm");
    expect(normalizarTexto("Bastão + corda")).toBe("bastao corda");
  });
});

describe("o que é duplicado", () => {
  it("mesmo nome escrito de outro jeito: já existe", () => {
    const p = primeiro("LONA 440 G REFORCADA");
    expect(p.material.nome).toBe("Lona 440g reforçada");
    expect(p.nivel).toBe("igual");
  });

  it("mesmas palavras em outra ordem: muito parecido", () => {
    const p = primeiro("Adesivo vinil branco");
    expect(p.material.nome).toBe("Vinil adesivo branco brilho");
    expect(p.nivel).toBe("provavel");
  });

  it("nome quase igual: muito parecido", () => {
    const p = primeiro("Acrilico cristal virgem 3 mm");
    expect(p.material.nome).toBe("ACRILICO CRISTAL VIRGEM 3MM");
    expect(["igual", "provavel"]).toContain(p.nivel);
  });

  it("medida diferente é outro material, nunca 'já existe'", () => {
    const lona = materiaisParecidos({ nome: "Lona 340g brilho", unidade: "m²" }, LISTA);
    expect(lona.length).toBeGreaterThan(0);
    for (const p of lona.filter((x) => x.material.nome.startsWith("Lona"))) {
      expect(p.motivo).toBe("outra_medida");
      expect(p.nivel).toBe("parecido");
    }
    const acm = compararMateriais({ nome: "Chapa ACM 4mm" }, LISTA.find((m) => m.nome === "Chapa ACM 3mm")!);
    expect(acm.motivo).toBe("outra_medida");
  });

  it("material sem relação não aparece", () => {
    expect(materiaisParecidos({ nome: "Fita dupla face", unidade: "un" }, LISTA)).toEqual([]);
    expect(materiaisParecidos({ nome: "ab" }, LISTA)).toEqual([]);
  });

  it("unidade diferente pesa contra, mas não esconde o nome igual", () => {
    const p = primeiro("Lona 440g reforçada", "kg");
    expect(p.material.nome).toBe("Lona 440g reforçada");
    expect(p.nivel).toBe("igual");
  });
});

describe("a conferência por IA", () => {
  it("lista curta vai inteira; lista longa vai pelos mais parecidos", () => {
    expect(candidatosParaIa({ nome: "Lona" }, LISTA)).toHaveLength(21);
    const longa = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, nome: `Material ${i}`, unidade: "un" }));
    expect(candidatosParaIa({ nome: "Lona" }, [...LISTA, ...longa], 10)).toHaveLength(10);
  });

  it("o pedido leva nome, unidade, características e fornecedor — nunca custo", () => {
    const comCusto = LISTA.map((m) => ({ ...m, custo_medio: 12.5 }) as MaterialComparavel);
    const mensagens = montarPerguntaDaIa({ nome: "Lona 440", unidade: "m2", caracteristicas: "fosca" }, comCusto);
    const texto = JSON.stringify(mensagens);
    expect(texto).toContain("Lona 440g reforçada");
    expect(texto).toContain("fosca");
    expect(texto).not.toMatch(/custo|12\.5/);
  });

  it("a resposta é lida sem confiar: id inventado some, resposta torta é falha", () => {
    const r = interpretarArgumentosDaIa(
      JSON.stringify({
        duplicados: [
          { id: "m11", motivo: "mesma lona 440g", certeza: "alta" },
          { id: "inventado", motivo: "x", certeza: "alta" },
        ],
        nome_sugerido: "Lona 440g reforçada",
      }),
      LISTA,
    );
    expect(r).toEqual({
      estado: "ok",
      duplicados: [{ id: "m11", nome: "Lona 440g reforçada", motivo: "mesma lona 440g", certeza: "alta" }],
      nome_sugerido: "Lona 440g reforçada",
    });
    expect(interpretarArgumentosDaIa("não é json", LISTA).estado).toBe("falhou");
    expect(interpretarArgumentosDaIa({ nada: true }, LISTA).estado).toBe("falhou");
    // nenhum duplicado é resposta válida, e nome vazio vira nulo
    expect(interpretarArgumentosDaIa({ duplicados: [], nome_sugerido: " " }, LISTA)).toEqual({
      estado: "ok",
      duplicados: [],
      nome_sugerido: null,
    });
  });
});

describe("número sem unidade ainda é a mesma medida", () => {
  it("'lona brilho 280' encontra a Lona 280g brilho como muito parecida", () => {
    const p = primeiro("lona brilho 280");
    expect(p.material.nome).toBe("Lona 280g brilho");
    expect(p.motivo).not.toBe("outra_medida");
    expect(p.nivel).toBe("provavel");
  });
});
