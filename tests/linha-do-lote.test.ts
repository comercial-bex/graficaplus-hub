import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  areaExataCobradaDoLote,
  areaExataDoLote,
  linhaDoLote,
  medidaEscrita,
  medidaNaUnidadeCerta,
  type EntradaDaLinhaDoLote,
} from "../src/domain/encaixe/linha-do-lote";
import { fraseDoResumo } from "../src/domain/orcamentos/resumo-do-item";
import { areaEmTexto, descreverItem, medidaEmTexto } from "../src/domain/os/o-que-produzir";

/**
 * A linha viva sob a quantidade (L1 e L1b da especificação, docs/simulador-de-encaixe/especificacao-de-ux.md,
 * seção 3.1 e Anexo A.1) e a regra de casas e de unidade que os outros textos de medida passaram a seguir.
 *
 * Os números dos casos de ouro (G1 a G10) vêm de docs/simulador-de-encaixe.md, seção 6. G8 não está aqui porque
 * a linha não olha para a máquina: o texto dele é o do G3.
 */

/** Peça quadrada, em metros, digitada em centímetros, vendida por m². */
function quadrado(
  lado: number,
  quantidade: number,
  resto: Partial<EntradaDaLinhaDoLote> = {},
): EntradaDaLinhaDoLote {
  return {
    largura: lado,
    altura: lado,
    quantidade,
    unidade: "m2",
    unidadeDeMedida: "cm",
    ...resto,
  };
}

describe("a linha do lote (L1): peças, medida e área", () => {
  const OURO: [string, EntradaDaLinhaDoLote, string][] = [
    ["G1: 40 de 4 × 4 cm", quadrado(0.04, 40), "40 peças de 4 × 4 cm = 0,064 m²"],
    ["G2: 40 de 6 × 6 cm", quadrado(0.06, 40), "40 peças de 6 × 6 cm = 0,144 m²"],
    ["G3: 500 de 4 × 4 cm", quadrado(0.04, 500), "500 peças de 4 × 4 cm = 0,80 m²"],
    ["G4: 25.000 de 4 × 4 cm", quadrado(0.04, 25_000), "25.000 peças de 4 × 4 cm = 40,00 m²"],
    ["G5: 10 de 50 × 50 cm", quadrado(0.5, 10), "10 peças de 50 × 50 cm = 2,50 m²"],
    [
      "G6: 1 de 1,5 × 1,5 m",
      quadrado(1.5, 1, { unidadeDeMedida: "m" }),
      "1 peça de 1,5 × 1,5 m = 2,25 m²",
    ],
    [
      "G7: 3 de 2 × 1 m",
      { largura: 2, altura: 1, quantidade: 3, unidade: "m2", unidadeDeMedida: "m" },
      "3 peças de 2 × 1 m = 6,00 m²",
    ],
    ["G9: 40 de 50 × 50 cm", quadrado(0.5, 40), "40 peças de 50 × 50 cm = 10,00 m²"],
    [
      "G10: 12 de 50 × 30 cm",
      { largura: 0.5, altura: 0.3, quantidade: 12, unidade: "m2", unidadeDeMedida: "cm" },
      "12 peças de 50 × 30 cm = 1,80 m²",
    ],
  ];

  it.each(OURO)("%s", (_nome, entrada, texto) => {
    // toStrictEqual: sem o mínimo, a chave `cobrado` nem existe.
    expect(linhaDoLote(entrada)).toStrictEqual({ texto });
  });

  it("uma peça escreve no singular, e a peça miúda sai em cm² inteiros", () => {
    expect(linhaDoLote(quadrado(0.04, 1))?.texto).toBe("1 peça de 4 × 4 cm = 16 cm²");
    expect(linhaDoLote(quadrado(0.06, 1))?.texto).toBe("1 peça de 6 × 6 cm = 36 cm²");
    expect(linhaDoLote(quadrado(0.045, 1))?.texto).toBe("1 peça de 4,5 × 4,5 cm = 20 cm²");
  });

  it("lote miúdo não é arredondado em 3 casas: 3 adesivos de 4 × 4 cm são 48 cm², não 50", () => {
    // areaTotal guarda o lote em 3 casas (0,0048 vira 0,005) e a tela diria "50 cm²".
    expect(linhaDoLote(quadrado(0.04, 3))?.texto).toBe("3 peças de 4 × 4 cm = 48 cm²");
    expect(linhaDoLote(quadrado(0.04, 5))?.texto).toBe("5 peças de 4 × 4 cm = 80 cm²");
    expect(linhaDoLote(quadrado(0.04, 6))?.texto).toBe("6 peças de 4 × 4 cm = 96 cm²");
    // A partir de 0,01 m² passa a m², com no máximo três casas.
    expect(linhaDoLote(quadrado(0.04, 7))?.texto).toBe("7 peças de 4 × 4 cm = 0,011 m²");
  });

  it("a área do lote não herda o erro de meio de area.ts: bate com o banco", () => {
    // 811 peças de 1 × 1 cm com mínimo de 25 cm²: 2,0275 m². O `areaCobrada` de area.ts devolve 2,027 (o truque
    // do EPSILON do arredondamento não funciona acima de 2 e o produto de ponto flutuante cai um fio abaixo do
    // meio); a coluna `area_cobrada` do banco, em numeric, arredonda o meio para cima: 2,028. A linha mostra o
    // número que o banco vai gravar.
    const item = { largura: 0.01, altura: 0.01, quantidade: 811 };
    expect(
      linhaDoLote({ ...item, unidade: "m2", unidadeDeMedida: "cm", areaMinima: 0.0025 })?.cobrado,
    ).toBe("Cobrado: 2,028 m², porque o mínimo do produto é 25 cm² por peça.");
  });

  it("quantidade vazia, zero, negativa ou inválida vale 1 peça (como areaTotal, areaCobrada e fraseDoResumo)", () => {
    for (const quantidade of [undefined, null, 0, -3, Number.NaN]) {
      expect(linhaDoLote(quadrado(0.04, 0, { quantidade }))?.texto).toBe(
        "1 peça de 4 × 4 cm = 16 cm²",
      );
    }
    expect(linhaDoLote(quadrado(0.04, 2.5))?.texto).toBe("2,5 peças de 4 × 4 cm = 40 cm²");
  });

  it("sem largura ou sem altura não há linha", () => {
    const vazias = [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY];
    for (const vazia of vazias) {
      expect(linhaDoLote(quadrado(0.04, 40, { largura: vazia }))).toBeNull();
      expect(linhaDoLote(quadrado(0.04, 40, { altura: vazia }))).toBeNull();
      expect(linhaDoLote(quadrado(0.04, 40, { largura: vazia, altura: vazia }))).toBeNull();
    }
    expect(linhaDoLote({ unidade: "m2" })).toBeNull();
    expect(linhaDoLote({})).toBeNull();
  });

  it("a medida vem escrita na unidade em que foi digitada (mm, cm ou m)", () => {
    const peca = (unidadeDeMedida: "mm" | "cm" | "m") =>
      linhaDoLote(quadrado(0.04, 40, { unidadeDeMedida }))?.texto;
    expect(peca("mm")).toBe("40 peças de 40 × 40 mm = 0,064 m²");
    expect(peca("cm")).toBe("40 peças de 4 × 4 cm = 0,064 m²");
    expect(peca("m")).toBe("40 peças de 0,04 × 0,04 m = 0,064 m²");

    const miuda = (unidadeDeMedida: "mm" | "cm" | "m") =>
      linhaDoLote(quadrado(0.045, 10, { unidadeDeMedida }))?.texto;
    expect(miuda("mm")).toBe("10 peças de 45 × 45 mm = 0,02 m²");
    expect(miuda("cm")).toBe("10 peças de 4,5 × 4,5 cm = 0,02 m²");
    expect(miuda("m")).toBe("10 peças de 0,045 × 0,045 m = 0,02 m²");

    const grande = (unidadeDeMedida: "mm" | "cm" | "m") =>
      linhaDoLote(quadrado(1.5, 1, { unidadeDeMedida }))?.texto;
    expect(grande("mm")).toBe("1 peça de 1500 × 1500 mm = 2,25 m²");
    expect(grande("cm")).toBe("1 peça de 150 × 150 cm = 2,25 m²");
    expect(grande("m")).toBe("1 peça de 1,5 × 1,5 m = 2,25 m²");
  });

  it("sem dizer a unidade de digitação, escreve em metros, como a tela era antes de lembrar a escolha", () => {
    const entrada = quadrado(0.04, 40);
    delete entrada.unidadeDeMedida;
    expect(linhaDoLote(entrada)?.texto).toBe("40 peças de 0,04 × 0,04 m = 0,064 m²");
    // Quem chama de fora do TypeScript e manda uma unidade que não existe também cai em metros, nunca em "NaN".
    const inventada = quadrado(0.04, 40, { unidadeDeMedida: "polegada" as never });
    expect(linhaDoLote(inventada)?.texto).toBe("40 peças de 0,04 × 0,04 m = 0,064 m²");
    expect(medidaEscrita(0.04, 0.04, "polegada" as never)).toBe("0,04 × 0,04 m");
  });

  it("largura e altura diferentes mantêm a ordem: largura primeiro", () => {
    expect(
      linhaDoLote({
        largura: 0.04,
        altura: 0.06,
        quantidade: 2,
        unidade: "un",
        unidadeDeMedida: "mm",
      })?.texto,
    ).toBe("2 peças de 40 × 60 mm = 48 cm²");
  });
});

describe("a linha do mínimo (L1b): só quando o mínimo muda a conta", () => {
  it("40 adesivos de 4 × 4 cm com mínimo de 0,10 m² por peça cobram 4,00 m²", () => {
    expect(linhaDoLote(quadrado(0.04, 40, { areaMinima: 0.1 }))).toStrictEqual({
      texto: "40 peças de 4 × 4 cm = 0,064 m²",
      cobrado: "Cobrado: 4,00 m², porque o mínimo do produto é 0,10 m² por peça.",
    });
  });

  it("uma peça com mínimo, e lote grande com separador de milhar", () => {
    expect(linhaDoLote(quadrado(0.04, 1, { areaMinima: 0.1 }))).toStrictEqual({
      texto: "1 peça de 4 × 4 cm = 16 cm²",
      cobrado: "Cobrado: 0,10 m², porque o mínimo do produto é 0,10 m² por peça.",
    });
    expect(linhaDoLote(quadrado(0.04, 25_000, { areaMinima: 0.1 }))?.cobrado).toBe(
      "Cobrado: 2.500,00 m², porque o mínimo do produto é 0,10 m² por peça.",
    );
  });

  it("mínimo miúdo sai em cm² e é exato: 3 peças com mínimo de 25 cm² são 75 cm², não 80", () => {
    // areaCobrada (3 casas no lote) diria 0,008 m², ou seja, "80 cm²".
    expect(linhaDoLote(quadrado(0.04, 3, { areaMinima: 0.0025 }))?.cobrado).toBe(
      "Cobrado: 75 cm², porque o mínimo do produto é 25 cm² por peça.",
    );
  });

  it("mínimo menor que a peça, igual a ela, zero ou ausente não diz nada", () => {
    // 4 × 4 cm = 0,0016 m². Menor: 0,001. Igual: 0,0016. Peça de 20 × 50 cm = 0,10 m² com mínimo de 0,10.
    expect(linhaDoLote(quadrado(0.04, 40, { areaMinima: 0.001 }))).toStrictEqual({
      texto: "40 peças de 4 × 4 cm = 0,064 m²",
    });
    expect(linhaDoLote(quadrado(0.04, 40, { areaMinima: 0.0016 }))?.cobrado).toBeUndefined();
    expect(
      linhaDoLote({ largura: 0.2, altura: 0.5, quantidade: 3, unidade: "m2", areaMinima: 0.1 })
        ?.cobrado,
    ).toBeUndefined();
    for (const areaMinima of [0, -1, null, undefined, Number.NaN]) {
      expect(linhaDoLote(quadrado(0.04, 40, { areaMinima }))?.cobrado).toBeUndefined();
    }
  });

  it("a área cobrada é a que o preço usa: o mínimo por peça vezes as peças", () => {
    const item = { largura: 0.04, altura: 0.04, quantidade: 40 };
    expect(areaExataCobradaDoLote(item, 0.1)).toBe(4);
    expect(areaExataCobradaDoLote(item, null)).toBe(0.064);
    expect(areaExataCobradaDoLote(item, 0.001)).toBe(0.064);
  });
});

describe("a linha só existe para quem conta peça ou área (m², un, peça)", () => {
  it.each(["mil", "milheiro", "h", "hora", "km", "kg", "m", "lote", "rolo"])(
    "unidade %s não tem linha",
    (unidade) => {
      expect(linhaDoLote(quadrado(0.04, 40, { unidade }))).toBeNull();
    },
  );

  it.each([
    "m2",
    "m²",
    "M²",
    "metro2",
    "un",
    "Unidade",
    "unidades",
    "peca",
    "peça",
    "Peças",
    "",
    null,
    undefined,
  ])("unidade %s tem linha", (unidade) => {
    expect(linhaDoLote(quadrado(0.04, 40, { unidade }))?.texto).toBe(
      "40 peças de 4 × 4 cm = 0,064 m²",
    );
  });
});

describe("medidaEscrita: a medida na unidade digitada, sem zero sobrando e com vírgula", () => {
  it("escreve os exemplos da especificação", () => {
    expect(medidaEscrita({ largura: 0.04, altura: 0.04 }, "cm")).toBe("4 × 4 cm");
    expect(medidaEscrita({ largura: 1.5, altura: 1.5 }, "m")).toBe("1,5 × 1,5 m");
    expect(medidaEscrita({ largura: 0.04, altura: 0.06 }, "mm")).toBe("40 × 60 mm");
  });

  it("aceita também os dois números soltos, e uma peça do encaixe inteira", () => {
    expect(medidaEscrita(0.04, 0.06, "mm")).toBe("40 × 60 mm");
    expect(medidaEscrita(1.5, 1.5, "m")).toBe("1,5 × 1,5 m");
    const peca = {
      id: "a",
      rotulo: "Adesivo",
      largura: 0.045,
      altura: 0.06,
      quantidade: 40,
      forma: "retangulo",
    };
    expect(medidaEscrita(peca, "cm")).toBe("4,5 × 6 cm");
  });

  it("não perde o milímetro em nenhuma das três unidades", () => {
    const erradas: string[] = [];
    const alturas = [1, 5, 45, 100, 450, 999, 1000, 1001, 1500, 2455, 2999];
    for (let largura = 1; largura <= 2999; largura++) {
      for (const altura of alturas) {
        for (const unidade of ["mm", "cm", "m"] as const) {
          const texto = medidaEscrita({ largura: largura / 1000, altura: altura / 1000 }, unidade);
          const lida = lerMedida(texto);
          if (lida.unidade !== unidade || lida.larguraMm !== largura || lida.alturaMm !== altura) {
            erradas.push(`${largura} x ${altura} ${unidade}: '${texto}'`);
          }
        }
      }
    }
    expect(erradas.slice(0, 5)).toEqual([]);
  }, 30_000);
});

describe("medidaNaUnidadeCerta: a medida dos textos que não sabem a unidade digitada", () => {
  it.each([
    [3, 2, "3,00 × 2,00 m"],
    [0.5, 0.5, "0,50 × 0,50 m"],
    [0.2, 0.2, "0,20 × 0,20 m"],
    [3, 0.7, "3,00 × 0,70 m"],
    // Centímetros inteiros ficam em metros com 2 casas, como sempre foi: não perde nada.
    [0.04, 0.04, "0,04 × 0,04 m"],
    // Milímetro numa peça pequena: centímetros com 1 casa. Em metros com 2 casas virava "0,05 × 0,05 m".
    [0.045, 0.045, "4,5 × 4,5 cm"],
    [0.375, 0.2, "37,5 × 20 cm"],
    [0.045, 0.05, "4,5 × 5 cm"],
    // Milímetro numa peça de 1 m ou mais: metros com 3 casas.
    [1.125, 0.5, "1,125 × 0,50 m"],
    [2.455, 1.205, "2,455 × 1,205 m"],
    [0.045, 1.5, "0,045 × 1,50 m"],
  ])("%s × %s: %s", (largura, altura, texto) => {
    expect(medidaNaUnidadeCerta(largura, altura)).toBe(texto);
  });

  it("nunca perde o milímetro, da peça de 1 mm à de 3 m", () => {
    const erradas: string[] = [];
    const alturas = [1, 5, 45, 100, 450, 999, 1000, 1001, 1500, 2455, 2999];
    for (let largura = 1; largura <= 2999; largura++) {
      for (const altura of alturas) {
        const texto = medidaNaUnidadeCerta(largura / 1000, altura / 1000);
        const lida = lerMedida(texto);
        if (lida.larguraMm !== largura || lida.alturaMm !== altura) {
          erradas.push(`${largura} x ${altura}: '${texto}'`);
        }
      }
    }
    expect(erradas.slice(0, 5)).toEqual([]);
  }, 30_000);
});

describe("a mesma regra de casas e de unidade nos outros textos", () => {
  it("o resumo antes de adicionar: 40 adesivos de 4 × 4 cm somam 0,064 m², não 0,06", () => {
    expect(
      fraseDoResumo({
        descricao: "Adesivo vinil",
        quantidade: 40,
        unidade: "m2",
        largura: 0.04,
        altura: 0.04,
      }),
    ).toBe("40 × Adesivo vinil · 0,04 × 0,04 m = 16 cm² a peça · 0,064 m² no total");
    expect(
      fraseDoResumo({
        descricao: "Adesivo vinil",
        quantidade: 40,
        unidade: "m2",
        largura: 0.06,
        altura: 0.06,
      }),
    ).toBe("40 × Adesivo vinil · 0,06 × 0,06 m = 36 cm² a peça · 0,144 m² no total");
  });

  it("o resumo escreve o adesivo de 4,5 cm como 4,5 cm, não como 5", () => {
    expect(
      fraseDoResumo({
        descricao: "Adesivo",
        quantidade: 10,
        unidade: "m2",
        largura: 0.045,
        altura: 0.045,
      }),
    ).toBe("10 × Adesivo · 4,5 × 4,5 cm = 20 cm² a peça · 0,02 m² no total");
  });

  it("o resumo de lote miúdo diz a área exata, e o mínimo miúdo também", () => {
    const item = {
      descricao: "Adesivo",
      quantidade: 3,
      unidade: "m2",
      largura: 0.04,
      altura: 0.04,
    };
    expect(fraseDoResumo(item)).toBe(
      "3 × Adesivo · 0,04 × 0,04 m = 16 cm² a peça · 48 cm² no total",
    );
    expect(fraseDoResumo({ ...item, areaMinima: 0.0025 })).toBe(
      "3 × Adesivo · 0,04 × 0,04 m = 16 cm² a peça · 48 cm² no total · cobrado 75 cm² (mínimo)",
    );
  });

  it("a ordem de serviço no quadro escreve a medida sem perder o milímetro", () => {
    expect(medidaEmTexto({ largura: 0.045, altura: 0.045 })).toBe("4,5 × 4,5 cm");
    // O numeric chega do PostgREST como texto.
    expect(medidaEmTexto({ largura: "0.045", altura: "0.045" })).toBe("4,5 × 4,5 cm");
    expect(medidaEmTexto({ largura: 1.125, altura: 0.5 })).toBe("1,125 × 0,50 m");
    expect(
      descreverItem({
        descricao: "Adesivo",
        largura: 0.045,
        altura: 0.045,
        quantidade: 10,
        unidade: "un",
      }),
    ).toBe("Adesivo · 4,5 × 4,5 cm · 10 un");
  });

  it("a metragem da ordem de serviço segue a regra de casas da tela de medidas", () => {
    expect(areaEmTexto(0.064)).toBe("0,064 m²");
    expect(areaEmTexto(0.0025)).toBe("25 cm²");
    expect(areaEmTexto(5.5)).toBe("5,50 m²");
    expect(areaEmTexto(1234.5)).toBe("1.234,50 m²");
    expect(areaEmTexto(0)).toBeNull();
    expect(areaEmTexto(null)).toBeNull();
  });
});

describe("a área exata do lote", () => {
  it("é a área da peça com 6 casas vezes as peças", () => {
    expect(areaExataDoLote({ largura: 0.04, altura: 0.04, quantidade: 3 })).toBe(0.0048);
    expect(areaExataDoLote({ largura: 0.04, altura: 0.04, quantidade: 40 })).toBe(0.064);
    expect(areaExataDoLote({ largura: 0.04, altura: 0.04, quantidade: 25_000 })).toBe(40);
    expect(areaExataDoLote({ largura: 0.04, altura: 0.04, quantidade: 0 })).toBe(0.0016);
  });

  it("é zero sem as duas medidas", () => {
    expect(areaExataDoLote({ largura: 0.04, quantidade: 3 })).toBe(0);
    expect(areaExataCobradaDoLote({ altura: 0.04, quantidade: 3 }, 0.1)).toBe(0);
  });

  it("a linha nunca escreve NaN, undefined nem ponto decimal, e o texto tem sempre a mesma forma", () => {
    const FORMA = /^[0-9.,]+ peças? de [0-9,]+ × [0-9,]+ (mm|cm|m) = [0-9.,]+ (m²|cm²)$/;
    const FORMA_COBRADO =
      /^Cobrado: [0-9.,]+ (m²|cm²), porque o mínimo do produto é [0-9.,]+ (m²|cm²) por peça[.]$/;
    let linhas = 0;
    for (const lado of [0.01, 0.045, 0.04, 0.1, 0.333, 0.5, 1, 1.5, 3.2]) {
      for (const quantidade of [1, 2, 3, 10, 40, 500, 25_000]) {
        for (const unidadeDeMedida of ["mm", "cm", "m"] as const) {
          for (const areaMinima of [null, 0.0025, 0.1, 5]) {
            const linha = linhaDoLote(quadrado(lado, quantidade, { unidadeDeMedida, areaMinima }));
            expect(linha, `${lado} x ${quantidade}`).not.toBeNull();
            expect(linha!.texto).toMatch(FORMA);
            if (linha!.cobrado !== undefined) expect(linha!.cobrado).toMatch(FORMA_COBRADO);
            linhas++;
          }
        }
      }
    }
    expect(linhas).toBe(9 * 7 * 3 * 4);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/* Guarda de texto: nada de travessão longo, travessão médio nem seta em texto de interface                       */
/* ------------------------------------------------------------------------------------------------------------- */

/**
 * Os quatro sinais que a casa não usa em texto de interface. Montados por código para que este arquivo, que é
 * varrido por inteiro, não os contenha.
 */
const PROIBIDOS: [string, string][] = [
  ["travessão longo", String.fromCharCode(0x2014)],
  ["travessão médio", String.fromCharCode(0x2013)],
  ["seta", String.fromCharCode(0x2192)],
  ["seta de duas letras", "-" + ">"],
];

/** Texto de todos os literais de texto de um código-fonte (aspas e crases), sem os comentários nem o código. */
function literaisDe(codigo: string): string[] {
  const fonte = ts.createSourceFile("varredura.ts", codigo, ts.ScriptTarget.ES2022, true);
  const textos: string[] = [];
  const visitar = (no: ts.Node) => {
    if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) textos.push(no.text);
    if (ts.isTemplateHead(no) || ts.isTemplateMiddle(no) || ts.isTemplateTail(no))
      textos.push(no.text);
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return textos;
}

const literaisDoArquivo = (caminho: string) => literaisDe(readFileSync(caminho, "utf8"));

describe("guarda de texto: nada de travessão nem seta na interface", () => {
  // Arquivos novos: o texto inteiro, comentários incluídos.
  it.each(["src/domain/encaixe/linha-do-lote.ts", "tests/linha-do-lote.test.ts"])(
    "%s, por inteiro",
    (caminho) => {
      const texto = readFileSync(caminho, "utf8");
      for (const [nome, sinal] of PROIBIDOS) {
        expect(texto.includes(sinal), `${caminho} tem ${nome}`).toBe(false);
      }
    },
  );

  // Arquivos antigos que só tiveram a formatação alterada: os comentários antigos têm travessão e não são
  // texto de interface; o que vai para a tela está nos literais, e esses não podem ter.
  it.each([
    "src/domain/orcamentos/resumo-do-item.ts",
    "src/domain/os/o-que-produzir.ts",
    "src/domain/producao/aproveitamento-bobina.ts",
  ])("%s, nos textos que vão para a tela", (caminho) => {
    const literais = literaisDoArquivo(caminho);
    expect(literais.length, `${caminho} não tem literal de texto?`).toBeGreaterThan(0);
    for (const [nome, sinal] of PROIBIDOS) {
      expect(
        literais.filter((l) => l.includes(sinal)),
        `${caminho} tem ${nome} em texto`,
      ).toEqual([]);
    }
  });

  it("a varredura de literais pega o sinal em aspas e em crases, e ignora comentário", () => {
    const longo = PROIBIDOS[0][1];
    const seta = PROIBIDOS[2][1];
    const codigo = [
      `const a = "um${longo}dois";`,
      `// comentário com ${longo}`,
      `/* outro com ${seta} */`,
      ["const b = ", "`", "tres", seta, "quatro", "`", ";"].join(""),
      `const c = [0].map((n) => n + 1);`,
    ].join(String.fromCharCode(10));
    expect(literaisDe(codigo)).toEqual([`um${longo}dois`, `tres${seta}quatro`]);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */

/** Lê de volta "4,5 × 4,5 cm" em milímetros inteiros, para provar que a escrita não perde nada. */
function lerMedida(texto: string): { larguraMm: number; alturaMm: number; unidade: string } {
  const espaco = texto.lastIndexOf(" ");
  const unidade = texto.slice(espaco + 1);
  const [largura, altura] = texto
    .slice(0, espaco)
    .split(" × ")
    .map((n) => Number(n.replace(",", ".")));
  const mmPorUnidade = unidade === "mm" ? 1 : unidade === "cm" ? 10 : 1000;
  return {
    larguraMm: Math.round(largura * mmPorUnidade),
    alturaMm: Math.round(altura * mmPorUnidade),
    unidade,
  };
}
