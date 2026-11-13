import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { EventoDaConversa, MensagemDaCaixa } from "../src/domain/whatsapp/caixa-de-entrada";
import {
  chaveDoDia,
  horaDaMensagem,
  montarLinhaDoTempo,
  posicaoDoDivisor,
  rotuloDoDia,
  type ItemCru,
} from "../src/domain/whatsapp/linha-do-tempo";
import {
  andarNaBusca,
  ocorrenciasDaBusca,
  resumoDaBusca,
} from "../src/domain/whatsapp/busca-na-conversa";

/**
 * A linha do tempo da conversa (onda 1, 12/11/2026, dono CONVERSA): separador de
 * dia no fuso de Belém, agrupamento das bolhas, divisor de não lidas, evento em
 * pílula, nota interna e a busca na conversa. O vitest roda em UTC: nenhuma
 * conta aqui pode depender do fuso do computador.
 */

// 12/11/2026 às 12:00 em Belém (UTC-3).
const AGORA = new Date("2026-11-12T15:00:00Z");

function msg(id: string, quando: string, extra: Partial<MensagemDaCaixa> = {}): ItemCru {
  const m: MensagemDaCaixa = {
    id,
    direcao: "entrada",
    tipo: "texto",
    status: "recebida",
    texto: `texto ${id}`,
    legenda: null,
    media_url: null,
    storage_bucket: null,
    storage_path: null,
    erro: null,
    recebido_em: quando,
    enviado_em: null,
    created_at: quando,
    ...extra,
  };
  return { tipo: "msg", quando, m };
}
function evento(id: string, quando: string, tipo: EventoDaConversa["tipo"] = "assumida"): ItemCru {
  return {
    tipo: "evento",
    quando,
    e: {
      id,
      conversa_id: "c1",
      tipo,
      de_usuario: null,
      para_usuario: null,
      detalhe: null,
      created_at: quando,
    } as EventoDaConversa,
  };
}
const saida = (id: string, quando: string, por: string | null = "u1") =>
  msg(id, quando, { direcao: "saida", status: "entregue", enviada_por: por, recebido_em: null, enviado_em: quando });

describe("o dia no fuso de Belém", () => {
  it('"Hoje", "Ontem" e a data por extenso', () => {
    expect(rotuloDoDia("2026-11-12T13:00:00Z", AGORA)).toBe("Hoje");
    expect(rotuloDoDia("2026-11-11T18:00:00Z", AGORA)).toBe("Ontem");
    expect(rotuloDoDia("2026-11-10T18:00:00Z", AGORA)).toBe("10/11/2026");
    expect(rotuloDoDia("2025-12-31T18:00:00Z", AGORA)).toBe("31/12/2025");
  });

  it("a virada do dia é a de Belém, não a de UTC", () => {
    // 02:30 UTC de 12/11 ainda é 23:30 de 11/11 em Belém.
    expect(rotuloDoDia("2026-11-12T02:30:00Z", AGORA)).toBe("Ontem");
    expect(chaveDoDia("2026-11-12T02:30:00Z")).toBe("2026-11-11");
    // 03:00 UTC já é 00:00 de 12/11.
    expect(chaveDoDia("2026-11-12T03:00:00Z")).toBe("2026-11-12");
    expect(rotuloDoDia("2026-11-12T03:00:00Z", AGORA)).toBe("Hoje");
  });

  it("a hora dentro da bolha é a de Belém, com 24 horas", () => {
    expect(horaDaMensagem("2026-11-12T17:32:00Z")).toBe("14:32");
    expect(horaDaMensagem("2026-11-12T03:05:00Z")).toBe("00:05");
    expect(horaDaMensagem("lixo")).toBe("");
  });
});

describe("montar a linha do tempo", () => {
  it("põe um separador de dia quando o dia muda, e nenhum no meio do dia", () => {
    const l = montarLinhaDoTempo(
      [
        msg("a", "2026-11-10T13:00:00Z"),
        msg("b", "2026-11-10T14:00:00Z"),
        msg("c", "2026-11-11T14:00:00Z"),
        msg("d", "2026-11-12T14:00:00Z"),
      ],
      { agora: AGORA },
    );
    const dias = l.flatMap((i) => (i.tipo === "dia" ? [i.rotulo] : []));
    expect(dias).toEqual(["10/11/2026", "Ontem", "Hoje"]);
    expect(l.map((i) => i.tipo)).toEqual(["dia", "msg", "msg", "dia", "msg", "dia", "msg"]);
  });

  it("ordena mensagens e eventos misturados pelo momento em que aconteceram", () => {
    const l = montarLinhaDoTempo(
      [
        msg("b", "2026-11-12T14:10:00Z"),
        evento("e1", "2026-11-12T14:05:00Z"),
        msg("a", "2026-11-12T14:00:00Z"),
      ],
      { agora: AGORA },
    );
    expect(l.filter((i) => i.tipo !== "dia").map((i) => ("id" in i ? i.id : i.tipo))).toEqual([
      "a",
      "e1",
      "b",
    ]);
  });

  it("agrupa bolhas seguidas do mesmo lado em até 5 minutos", () => {
    const l = montarLinhaDoTempo(
      [
        msg("1", "2026-11-12T14:00:00Z"),
        msg("2", "2026-11-12T14:03:00Z"),
        msg("3", "2026-11-12T14:07:59Z"),
        msg("4", "2026-11-12T14:20:00Z"),
      ],
      { agora: AGORA },
    );
    const bolhas = l.flatMap((i) => (i.tipo === "msg" ? [i] : []));
    expect(bolhas.map((b) => [b.id, b.primeiraDoGrupo, b.ultimaDoGrupo])).toEqual([
      ["1", true, false],
      ["2", false, false],
      ["3", false, true],
      ["4", true, true],
    ]);
  });

  it("lado diferente, pessoa diferente ou evento no meio quebram o grupo", () => {
    const l = montarLinhaDoTempo(
      [
        msg("c1", "2026-11-12T14:00:00Z"),
        saida("s1", "2026-11-12T14:01:00Z", "u1"),
        saida("s2", "2026-11-12T14:02:00Z", "u2"),
        saida("s3", "2026-11-12T14:03:00Z", "u2"),
        evento("e", "2026-11-12T14:03:30Z"),
        saida("s4", "2026-11-12T14:04:00Z", "u2"),
      ],
      { agora: AGORA },
    );
    const bolhas = l.flatMap((i) => (i.tipo === "msg" ? [i] : []));
    expect(Object.fromEntries(bolhas.map((b) => [b.id, b.primeiraDoGrupo]))).toEqual({
      c1: true,
      s1: true,
      s2: true,
      s3: false,
      s4: true,
    });
  });

  it("dia diferente quebra o grupo mesmo a poucos minutos de distância", () => {
    const l = montarLinhaDoTempo(
      [msg("a", "2026-11-12T02:58:00Z"), msg("b", "2026-11-12T03:01:00Z")],
      { agora: AGORA },
    );
    const bolhas = l.flatMap((i) => (i.tipo === "msg" ? [i] : []));
    expect(bolhas.map((b) => b.primeiraDoGrupo)).toEqual([true, true]);
  });

  it("evento da equipe vira pílula e nota interna vira nota", () => {
    const l = montarLinhaDoTempo(
      [evento("e", "2026-11-12T14:00:00Z", "transferida"), evento("n", "2026-11-12T14:01:00Z", "nota")],
      { agora: AGORA },
    );
    expect(l.map((i) => i.tipo)).toEqual(["dia", "evento", "nota"]);
  });

  it("o divisor de não lidas entra antes da mais antiga das não lidas do cliente", () => {
    const itens = [
      msg("c1", "2026-11-12T13:00:00Z"),
      saida("s1", "2026-11-12T13:10:00Z"),
      msg("c2", "2026-11-12T13:20:00Z"),
      saida("s2", "2026-11-12T13:25:00Z"),
      msg("c3", "2026-11-12T13:30:00Z"),
    ];
    const l = montarLinhaDoTempo(itens, { agora: AGORA, naoLidas: 2 });
    expect(l.map((i) => (i.tipo === "msg" ? i.id : i.tipo))).toEqual([
      "dia",
      "c1",
      "s1",
      "nao_lidas",
      "c2",
      "s2",
      "c3",
    ]);
    const divisor = l.find((i) => i.tipo === "nao_lidas");
    expect(divisor).toEqual({ tipo: "nao_lidas", quantidade: 2 });
  });

  it("sem não lidas não há divisor; com mais não lidas que mensagens, entra antes da primeira do cliente", () => {
    const itens = [saida("s0", "2026-11-12T12:50:00Z"), msg("c1", "2026-11-12T13:00:00Z"), msg("c2", "2026-11-12T13:05:00Z")];
    expect(montarLinhaDoTempo(itens, { agora: AGORA, naoLidas: 0 }).some((i) => i.tipo === "nao_lidas")).toBe(false);
    const todas = montarLinhaDoTempo(itens, { agora: AGORA, naoLidas: 40 });
    expect(todas.map((i) => (i.tipo === "msg" ? i.id : i.tipo))).toEqual([
      "dia",
      "s0",
      "nao_lidas",
      "c1",
      "c2",
    ]);
    // Só mensagens nossas: nada a marcar.
    expect(posicaoDoDivisor([{ direcao: "saida" }], 3)).toBe(-1);
    expect(posicaoDoDivisor([], 3)).toBe(-1);
  });

  it("o divisor cai depois do separador de dia quando a primeira não lida abre o dia", () => {
    const l = montarLinhaDoTempo(
      [msg("a", "2026-11-11T14:00:00Z"), msg("b", "2026-11-12T14:00:00Z")],
      { agora: AGORA, naoLidas: 1 },
    );
    expect(l.map((i) => (i.tipo === "msg" ? i.id : i.tipo))).toEqual(["dia", "a", "dia", "nao_lidas", "b"]);
  });
});

describe("a busca na conversa", () => {
  const lista = [
    { id: "1", texto: "Bom dia, preciso de 100 cartões" },
    { id: "2", texto: "Qual o prazo?" },
    { id: "3", texto: "Cartão de visita, 2 CARTÕES extras" },
  ];

  it("acha sem diferenciar acento nem maiúscula, na ordem da conversa", () => {
    expect(ocorrenciasDaBusca(lista, "CARTOES")).toEqual(["1", "3"]);
    expect(ocorrenciasDaBusca(lista, "cartao")).toEqual(["3"]);
    expect(ocorrenciasDaBusca(lista, "PRAZO")).toEqual(["2"]);
    expect(ocorrenciasDaBusca(lista, "  ")).toEqual([]);
    expect(ocorrenciasDaBusca(lista, "orçamento")).toEqual([]);
  });

  it("anda em círculo: depois da última volta para a primeira", () => {
    expect(andarNaBusca(0, 3, 1)).toBe(1);
    expect(andarNaBusca(2, 3, 1)).toBe(0);
    expect(andarNaBusca(0, 3, -1)).toBe(2);
    expect(andarNaBusca(-1, 3, 1)).toBe(0);
    expect(andarNaBusca(-1, 3, -1)).toBe(2);
    expect(andarNaBusca(0, 0, 1)).toBe(-1);
  });

  it('o contador diz "2 de 5" ou "Nada encontrado"', () => {
    expect(resumoDaBusca(1, 5, "oi")).toBe("2 de 5");
    expect(resumoDaBusca(-1, 0, "oi")).toBe("Nada encontrado");
    expect(resumoDaBusca(-1, 0, "")).toBe("");
  });
});

describe("a tela da linha do tempo", () => {
  const COMPONENTE = readFileSync("src/components/whatsapp/linha-do-tempo.tsx", "utf8");
  const BOLHA = readFileSync("src/components/whatsapp/bolha-da-mensagem.tsx", "utf8");
  const semComentarios = (s: string) =>
    s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("usa os tokens --chat-*, sem cor fixa de bolha", () => {
    const tela = semComentarios(COMPONENTE + BOLHA);
    for (const classe of ["bg-chat-fundo", "bg-chat-saida", "bg-chat-entrada", "bg-chat-nota", "text-chat-nota-texto", "bg-chat-pilula"])
      expect(tela, classe).toContain(classe);
    expect(tela).not.toMatch(/bg-\[#|text-\[#/);
  });

  it("tem o divisor de não lidas, o botão de descer e Mensagens anteriores, todos de 44 px", () => {
    expect(COMPONENTE).toContain("Mensagens não lidas");
    expect(COMPONENTE).toContain("Ir para as mensagens mais recentes");
    expect(COMPONENTE).toContain("Mensagens anteriores");
    expect(COMPONENTE).toMatch(/className="pointer-events-auto size-11/);
    expect(COMPONENTE).toMatch(/className="h-11 rounded-full px-4 text-sm"/);
  });

  it("hora e tique ficam dentro da bolha; figurinha sem fundo leva a pílula", () => {
    expect(BOLHA).toContain("<TiqueDaMensagem");
    expect(BOLHA).toContain("horaDaMensagem(");
    expect(BOLHA).toContain("bolhaSemFundo(m)");
    expect(BOLHA).toContain("bg-chat-pilula");
  });

  it("a rolagem é desta área (a página não rola) e a bolha é memorizada", () => {
    expect(COMPONENTE).toContain("overflow-y-auto");
    expect(COMPONENTE).not.toMatch(/calc\(100d?vh/);
    expect(BOLHA).toContain("export const BolhaDaMensagem = memo(");
  });

  it("os botões da bolha têm 44 px e nada de title=, travessão ou seta em texto", () => {
    expect(BOLHA).toMatch(/className="mt-1\.5 h-11 text-sm"/);
    for (const fonte of [COMPONENTE, BOLHA]) {
      expect(semComentarios(fonte)).not.toMatch(/\btitle=/);
      expect(semComentarios(fonte)).not.toMatch(/[—–→←⇒]/);
    }
  });
});

describe("contraste das cores da conversa (4,5:1 ou mais, em claro e escuro)", () => {
  const CSS = readFileSync("src/styles.css", "utf8");
  const bloco = CSS.slice(CSS.indexOf("início CONVERSA"), CSS.indexOf("fim CONVERSA"));
  const doTema = (seletor: ":root" | ".dark") => {
    const inicio = bloco.indexOf(`${seletor} {`);
    const corpo = bloco.slice(inicio, bloco.indexOf("}", inicio));
    return Object.fromEntries(
      [...corpo.matchAll(/--chat-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]),
    ) as Record<string, string>;
  };
  const luminancia = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const razao = (a: string, b: string) => {
    const [la, lb] = [luminancia(a), luminancia(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  // Todo par (texto, fundo) que a conversa desenha: bolha de entrada e de saída,
  // pílula do dia e do evento, nota, "Mensagens não lidas", carregando sobre o fundo.
  const pares: [string, string][] = [
    ["texto", "entrada"],
    ["texto", "saida"],
    ["texto", "fundo"],
    ["hora", "entrada"],
    ["hora-saida", "saida"],
    ["tique-lida", "saida"],
    ["falha", "saida"],
    ["falha", "entrada"],
    ["pilula-texto", "pilula"],
    ["verde-texto", "pilula"],
    ["nota-texto", "nota"],
    ["contador-texto", "contador"],
    ["texto", "realce"],
  ];
  for (const tema of [":root", ".dark"] as const) {
    it(`todos os pares passam de 4,5:1 no tema ${tema === ":root" ? "claro" : "escuro"}`, () => {
      const t = doTema(tema);
      const abaixo = pares
        .map(([frente, fundo]) => ({ par: `${frente} em ${fundo}`, r: razao(t[frente], t[fundo]) }))
        .filter((x) => x.r < 4.5);
      expect(abaixo).toEqual([]);
    });
  }
});
