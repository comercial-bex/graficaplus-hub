import { describe, expect, it } from "vitest";
import { pendenciasParaEnviar } from "../src/domain/orcamentos/acordo";
import {
  PASSOS_DA_EQUIPE,
  estadoDosPassosDaEquipe,
  passoDaPendencia,
  passoInicialDaEquipe,
  type EntradaDosPassosDaEquipe,
} from "../src/domain/orcamentos/passos-da-equipe";

/**
 * O orçamento da equipe nos mesmos quatro passos do parceiro (25/10/2026).
 * Os passos não criam regra nova: leem as pendências que o orçamento já tinha.
 */

const entrada = (o: Partial<EntradaDosPassosDaEquipe> = {}): EntradaDosPassosDaEquipe => ({
  clienteNome: "Mercado Boa Compra",
  itens: 2,
  total: 180,
  pendencias: [],
  fechado: false,
  ...o,
});

describe("os quatro passos da equipe", () => {
  it("têm os mesmos títulos do parceiro, com a pergunta própria de quem vende", () => {
    expect(PASSOS_DA_EQUIPE.map((p) => p.titulo)).toEqual([
      "Cliente",
      "Itens",
      "Condições",
      "Revisão",
    ]);
    expect(PASSOS_DA_EQUIPE[2].pergunta).toContain("entrega");
    expect(PASSOS_DA_EQUIPE[2].pergunta).toContain("paga");
  });
});

describe("em que passo cada pendência se resolve", () => {
  it.each([
    ["cliente ou contato", 1],
    ["itens", 2],
    ["layout em 1 item", 2],
    ["layout em 3 itens", 2],
    ["data de entrega", 3],
    ["condição de pagamento", 3],
    ["aprovação do desconto", 3],
    ["qualquer coisa nova", 4],
  ])("%s → passo %i", (pendencia, passo) => {
    expect(passoDaPendencia(pendencia)).toBe(passo);
  });

  it("cobre TODAS as pendências que `pendenciasParaEnviar` sabe produzir", () => {
    const todas = pendenciasParaEnviar({
      temClienteOuContato: false,
      dataEntrega: null,
      verPreco: true,
      temCondicao: false,
      itens: [],
      descontoPendente: true,
    });
    expect(todas).toEqual([
      "cliente ou contato",
      "data de entrega",
      "condição de pagamento",
      "aprovação do desconto",
      "itens",
    ]);
    for (const p of todas) expect(passoDaPendencia(p), p).toBeLessThan(4);
  });
});

describe("o que a barra mostra", () => {
  it("tudo certo: os quatro passos preenchidos", () => {
    const e = estadoDosPassosDaEquipe(entrada());
    expect(e.map((x) => x.situacao)).toEqual([
      "preenchido",
      "preenchido",
      "preenchido",
      "preenchido",
    ]);
    expect(e[0].resumo).toBe("Mercado Boa Compra");
    expect(e[1].resumo).toContain("2 itens");
    expect(e[1].resumo).toContain("180,00");
    expect(e[2].resumo).toBe("entrega e pagamento definidos");
    expect(e[3].resumo).toBe("pronto para enviar");
  });

  it("quem não vê preço não vê valor na barra", () => {
    expect(estadoDosPassosDaEquipe(entrada({ total: null }))[1].resumo).toBe("2 itens");
  });

  it("falta o cliente: passo 1 vazio", () => {
    const e = estadoDosPassosDaEquipe(
      entrada({ clienteNome: null, pendencias: ["cliente ou contato"] }),
    );
    expect(e[0]).toMatchObject({ situacao: "vazio", resumo: "falta o cliente" });
    expect(e[3].resumo).toBe("1 pendência");
  });

  it("contato sem nome de cliente ainda é cliente informado", () => {
    expect(estadoDosPassosDaEquipe(entrada({ clienteNome: null }))[0]).toMatchObject({
      situacao: "preenchido",
      resumo: "contato informado",
    });
  });

  it("sem itens: passo 2 vazio", () => {
    const e = estadoDosPassosDaEquipe(entrada({ itens: 0, total: 0, pendencias: ["itens"] }));
    expect(e[1]).toMatchObject({ situacao: "vazio", resumo: "nenhum item" });
  });

  it("falta layout não é erro: o passo segue preenchido e avisa", () => {
    const e = estadoDosPassosDaEquipe(entrada({ pendencias: ["layout em 2 itens"] }));
    expect(e[1]).toMatchObject({ situacao: "preenchido" });
    expect(e[1].resumo).toContain("falta layout");
    expect(e[3].resumo).toBe("1 pendência");
  });

  it("falta entrega e pagamento: diz a primeira e quantas mais", () => {
    const e = estadoDosPassosDaEquipe(
      entrada({ pendencias: ["data de entrega", "condição de pagamento"] }),
    );
    expect(e[2]).toMatchObject({ situacao: "vazio", resumo: "falta data de entrega (+1)" });
  });

  it("desconto esperando aprovação é problema, no passo das condições e na revisão", () => {
    const e = estadoDosPassosDaEquipe(entrada({ pendencias: ["aprovação do desconto"] }));
    expect(e[2]).toMatchObject({ situacao: "problema", resumo: "desconto espera aprovação" });
    expect(e[3].situacao).toBe("problema");
  });

  it("orçamento que virou OS: revisão preenchida e diz que virou OS", () => {
    const e = estadoDosPassosDaEquipe(entrada({ fechado: true, pendencias: ["layout em 1 item"] }));
    expect(e[3]).toMatchObject({ situacao: "preenchido", resumo: "virou OS" });
  });
});

describe("onde o orçamento abre", () => {
  it("convertido em OS, na revisão", () => {
    expect(passoInicialDaEquipe({ fechado: true, itens: 3, pendencias: [] })).toBe(4);
  });

  it("sem itens, nos itens", () => {
    expect(passoInicialDaEquipe({ fechado: false, itens: 0, pendencias: ["itens"] })).toBe(2);
  });

  it("tudo certo, na revisão", () => {
    expect(passoInicialDaEquipe({ fechado: false, itens: 2, pendencias: [] })).toBe(4);
  });

  it("faltando algo, no primeiro passo que falta", () => {
    expect(
      passoInicialDaEquipe({
        fechado: false,
        itens: 2,
        pendencias: ["condição de pagamento", "layout em 1 item"],
      }),
    ).toBe(2);
    expect(
      passoInicialDaEquipe({ fechado: false, itens: 2, pendencias: ["data de entrega"] }),
    ).toBe(3);
    expect(
      passoInicialDaEquipe({
        fechado: false,
        itens: 2,
        pendencias: ["cliente ou contato", "data de entrega"],
      }),
    ).toBe(1);
  });
});
