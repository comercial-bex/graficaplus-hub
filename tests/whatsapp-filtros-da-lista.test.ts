import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CHIPS_DA_LISTA,
  chipDoFiltro,
  contarNaoLidas,
  filtroDoChip,
  idsNaoLidos,
  mostrarFiltroDeFila,
} from "../src/domain/whatsapp/filtros-da-lista";

describe("os seis chips da lista (12/11/2026)", () => {
  it("são seis, na ordem do pedido do dono", () => {
    expect(CHIPS_DA_LISTA.map((c) => c.rotulo)).toEqual([
      "Abertas",
      "Não lidas",
      "Minhas",
      "Sem responsável",
      "Pendentes",
      "Resolvidas",
    ]);
  });

  it("cada chip vira { fila, status, naoLidas }", () => {
    expect(filtroDoChip("abertas")).toEqual({ fila: "todas", status: "aberta", naoLidas: false });
    expect(filtroDoChip("nao_lidas")).toEqual({ fila: "todas", status: "aberta", naoLidas: true });
    expect(filtroDoChip("minhas")).toEqual({ fila: "minhas", status: "aberta", naoLidas: false });
    expect(filtroDoChip("sem_responsavel")).toEqual({ fila: "nao_atribuidas", status: "aberta", naoLidas: false });
    expect(filtroDoChip("pendentes")).toEqual({ fila: "todas", status: "pendente", naoLidas: false });
    expect(filtroDoChip("resolvidas")).toEqual({ fila: "todas", status: "resolvida", naoLidas: false });
  });

  it("e volta ao mesmo chip (ida e volta, sem dois chips para o mesmo filtro)", () => {
    for (const { valor } of CHIPS_DA_LISTA) {
      expect(chipDoFiltro(filtroDoChip(valor))).toBe(valor);
    }
    const filtros = CHIPS_DA_LISTA.map((c) => JSON.stringify(filtroDoChip(c.valor)));
    expect(new Set(filtros).size).toBe(6);
  });

  it("filtro que nenhum chip produz não marca chip nenhum", () => {
    expect(chipDoFiltro({ fila: "minhas", status: "pendente", naoLidas: false })).toBeNull();
    expect(chipDoFiltro({ fila: "minhas", status: "aberta", naoLidas: true })).toBeNull();
  });

  it("devolve cópia: mexer no resultado não estraga a tabela", () => {
    const f = filtroDoChip("abertas");
    f.status = "resolvida";
    expect(filtroDoChip("abertas").status).toBe("aberta");
  });
});

describe("não lidas por quem olha", () => {
  const mapa = new Map([
    ["a", 3],
    ["b", 0],
    ["c", 1],
  ]);
  it("conta CONVERSAS, não mensagens", () => {
    expect(contarNaoLidas(mapa)).toBe(2);
    expect(contarNaoLidas(undefined)).toBe(0);
    expect(contarNaoLidas(new Map())).toBe(0);
  });
  it("lista os ids das conversas com mensagem não lida", () => {
    expect(idsNaoLidos(mapa)).toEqual(["a", "c"]);
    expect(idsNaoLidos(null)).toEqual([]);
  });
});

describe("o filtro de fila só aparece quando serve", () => {
  const so = [{ fila: "comercial" as const, abertas: 145, aguardando: 2 }];
  const duas = [...so, { fila: "producao" as const, abertas: 3, aguardando: 0 }];

  it("hoje, com as 145 todas na Comercial, não aparece", () => {
    expect(mostrarFiltroDeFila({ contagem: so, setor: "minhas_filas", listaVazia: false })).toBe(false);
    expect(mostrarFiltroDeFila({ contagem: so, setor: "todas", listaVazia: false })).toBe(false);
    expect(mostrarFiltroDeFila({ contagem: undefined, setor: "minhas_filas", listaVazia: false })).toBe(false);
  });

  it("com conversa em mais de uma fila, aparece", () => {
    expect(mostrarFiltroDeFila({ contagem: duas, setor: "minhas_filas", listaVazia: false })).toBe(true);
  });

  it("fila sem nenhuma conversa aberta não conta como fila", () => {
    const zerada = [...so, { fila: "financeiro" as const, abertas: 0, aguardando: 0 }];
    expect(mostrarFiltroDeFila({ contagem: zerada, setor: "todas", listaVazia: false })).toBe(false);
  });

  it("olhando uma fila específica, aparece (senão não há como sair dela)", () => {
    expect(mostrarFiltroDeFila({ contagem: so, setor: "producao", listaVazia: true })).toBe(true);
  });

  it("o padrão deixou a lista vazia enquanto há conversa em outra fila: aparece", () => {
    expect(mostrarFiltroDeFila({ contagem: so, setor: "minhas_filas", listaVazia: true })).toBe(true);
  });
});

describe("Não lidas cobre o que o número conta (revisão da onda 1, 12/11/2026)", () => {
  it("a consulta do chip pede aberta e pendente: a RPC whatsapp_nao_lidas conta as duas", () => {
    const fonte = readFileSync("src/components/whatsapp/usar-caixa-de-entrada.ts", "utf8");
    expect(fonte).toMatch(/f\.naoLidasIds && f\.status === "aberta"\s*\? q\.in\("status", \["aberta", "pendente"\]\)/);
  });
});
