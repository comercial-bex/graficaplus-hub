import { describe, expect, it } from "vitest";
import {
  deCSV,
  detectarSeparador,
  escreverNumero,
  lerNumero,
  paraCSV,
} from "../src/domain/custos/planilha-csv";

/**
 * O CSV da planilha de custos vai e volta pelo Excel em português. As duas
 * convenções brigam: pt-BR usa `;` e vírgula decimal, en-US usa `,` e ponto.
 * Ler errado não dá erro — dá custo errado, que é pior.
 */
describe("números em português e em inglês", () => {
  const casos: [string, number | null][] = [
    ["9,50", 9.5],
    ["9.50", 9.5],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["0,09", 0.09],
    ["R$ 95,00", 95],
    ["  12,5  ", 12.5],
    ["1234", 1234],
    ["0", 0],
    ["", null],
    ["abc", null],
    ["--", null],
  ];

  for (const [entrada, esperado] of casos) {
    it(`lê ${JSON.stringify(entrada)} como ${esperado}`, () => {
      expect(lerNumero(entrada)).toBe(esperado);
    });
  }

  it("valor ilegível vira null, nunca zero", () => {
    // Custo zero e custo ilegível levam a decisões opostas: um diz "de graça",
    // o outro diz "não sei". Confundir os dois é vender abaixo do custo.
    expect(lerNumero("???")).toBeNull();
    expect(lerNumero("0")).toBe(0);
  });

  it("escreve com vírgula, que é o que o Excel pt-BR espera", () => {
    expect(escreverNumero(9.5, 2)).toBe("9,50");
    expect(escreverNumero(0.09, 4)).toBe("0,0900");
    expect(escreverNumero(null)).toBe("");
  });
});

describe("separador do arquivo", () => {
  it("reconhece ponto e vírgula (Excel pt-BR)", () => {
    expect(detectarSeparador("nome;unidade;custo")).toBe(";");
  });
  it("reconhece vírgula (padrão americano)", () => {
    expect(detectarSeparador("nome,unidade,custo")).toBe(",");
  });
  it("não se confunde com vírgula dentro de aspas", () => {
    expect(detectarSeparador('"nome, completo";unidade;custo')).toBe(";");
  });
});

describe("leitura do arquivo", () => {
  it("lê o formato que o Excel pt-BR gera", () => {
    const csv = "nome;unidade;custo\r\nLona 280g;m2;9,50\r\nIlhós;un;0,35\r\n";
    const linhas = deCSV(csv);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toEqual({ nome: "Lona 280g", unidade: "m2", custo: "9,50" });
    expect(lerNumero(linhas[1].custo)).toBe(0.35);
  });

  it("lê o formato americano sem ajuda nenhuma", () => {
    const linhas = deCSV("nome,unidade,custo\nLona 280g,m2,9.50\n");
    expect(linhas[0].custo).toBe("9.50");
    expect(lerNumero(linhas[0].custo)).toBe(9.5);
  });

  it("respeita separador dentro de aspas", () => {
    const linhas = deCSV('nome;observacao;custo\n"Lona 280g";"brilho; 440g";9,50\n');
    expect(linhas[0].observacao).toBe("brilho; 440g");
    expect(linhas[0].custo).toBe("9,50");
  });

  it("respeita quebra de linha dentro de aspas", () => {
    // Observação com duas linhas picotaria a planilha inteira.
    const linhas = deCSV('nome;observacao\n"Lona";"primeira\nsegunda"\n');
    expect(linhas).toHaveLength(1);
    expect(linhas[0].observacao).toBe("primeira\nsegunda");
  });

  it("entende aspas escapadas", () => {
    const linhas = deCSV('nome;obs\nLona;"aspas ""assim"" dentro"\n');
    expect(linhas[0].obs).toBe('aspas "assim" dentro');
  });

  it("remove o BOM que o Excel escreve", () => {
    // Sem tirar, a primeira coluna vira "﻿nome" e nada casa.
    const linhas = deCSV("﻿nome;custo\nLona;9,50\n");
    expect(Object.keys(linhas[0])).toEqual(["nome", "custo"]);
  });

  it("ignora linhas em branco e arquivo vazio", () => {
    expect(deCSV("nome;custo\n\nLona;9,50\n\n")).toHaveLength(1);
    expect(deCSV("")).toEqual([]);
    expect(deCSV("   ")).toEqual([]);
  });

  it("aceita linha com menos colunas que o cabeçalho", () => {
    const linhas = deCSV("nome;unidade;custo\nLona;m2\n");
    expect(linhas[0]).toEqual({ nome: "Lona", unidade: "m2", custo: "" });
  });
});

describe("ida e volta", () => {
  it("o que sai volta igual", () => {
    const colunas = ["nome", "unidade", "custo", "observacao"];
    const originais = [
      { nome: "Lona 280g", unidade: "m2", custo: escreverNumero(9.5, 2), observacao: "brilho; 440g" },
      { nome: 'Chapa "ACM"', unidade: "m2", custo: escreverNumero(95, 2), observacao: "" },
      { nome: "Tinta", unidade: "ml", custo: escreverNumero(0.09, 4), observacao: "linha\nquebrada" },
    ];
    const lidas = deCSV(paraCSV(colunas, originais));
    expect(lidas).toEqual(originais);
    expect(lerNumero(lidas[0].custo)).toBe(9.5);
    expect(lerNumero(lidas[2].custo)).toBe(0.09);
  });
});
