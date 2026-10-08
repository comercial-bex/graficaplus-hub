import { describe, expect, it } from "vitest";
import {
  diaLocal,
  diasDaJanela,
  formatarMinutos,
  inicioDaJanela,
  inicioDoDia,
  mensagensPorDia,
  porAtendente,
  quemEnviou,
  resumoDaEspera,
  resumoDoDia,
  resumoDosAtendimentos,
  resumoDosLeads,
  resumoDosOrcamentos,
  rotuloDoDia,
  saudeDaConexao,
  tempos,
  type AtendimentoDoPainel,
  type MensagemDoPainel,
} from "@/domain/whatsapp/visao-geral";

/**
 * A Visão geral conta linhas do banco. O que se segura:
 *   - "hoje" é o dia de Macapá (UTC−3), não o de Greenwich;
 *   - modelo de empresa (propaganda) não conta como cliente;
 *   - tempo de resposta: mediana e média sobre os atendimentos, spam fora;
 *   - número quieto é "atenção", não "fora do ar".
 */

// Quinta, 08/10/2026, 10h em Macapá.
const AGORA = new Date("2026-10-08T13:00:00Z");

function msg(p: Partial<MensagemDoPainel> & { quando: string }): MensagemDoPainel {
  return {
    direcao: p.direcao ?? "entrada",
    origem: p.origem ?? null,
    enviada_por: p.enviada_por ?? null,
    recebido_em: p.direcao === "saida" ? null : p.quando,
    enviado_em: p.direcao === "saida" ? p.quando : null,
    created_at: p.quando,
  };
}

function at(p: Partial<AtendimentoDoPainel> & { aberto_em: string }): AtendimentoDoPainel {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    fila: p.fila ?? "comercial",
    aberto_em: p.aberto_em,
    primeira_resposta_em: p.primeira_resposta_em ?? null,
    fechado_em: p.fechado_em ?? null,
    fechado_por: p.fechado_por ?? null,
    responsavel_id: p.responsavel_id ?? null,
    motivo_resolucao: p.motivo_resolucao ?? null,
  };
}

describe("datas de Macapá", () => {
  it("o dia vira à meia-noite local (03h UTC), não à meia-noite UTC", () => {
    expect(diaLocal(new Date("2026-10-08T02:59:00Z"))).toBe("2026-10-07");
    expect(diaLocal(new Date("2026-10-08T03:00:00Z"))).toBe("2026-10-08");
    expect(inicioDoDia(AGORA).toISOString()).toBe("2026-10-08T03:00:00.000Z");
  });

  it("a janela de 7 dias inclui hoje e começa 6 dias antes", () => {
    expect(inicioDaJanela(AGORA).toISOString()).toBe("2026-10-02T03:00:00.000Z");
    expect(diasDaJanela(AGORA)).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]);
    expect(rotuloDoDia("2026-10-08")).toBe("qui 08");
  });

  it("formata minutos como a fila humana", () => {
    expect(formatarMinutos(0.4)).toBe("< 1 min");
    expect(formatarMinutos(12)).toBe("12 min");
    expect(formatarMinutos(125)).toBe("2 h 05");
    expect(formatarMinutos(120)).toBe("2 h");
    expect(formatarMinutos(60 * 24 * 3 + 60 * 4)).toBe("3 d 4 h");
    expect(formatarMinutos(null)).toBe("—");
  });
});

describe("mensagens", () => {
  it("quem enviou: modelo de empresa não é cliente; saída sem autor é o celular", () => {
    expect(quemEnviou({ direcao: "entrada", origem: "humano", enviada_por: null })).toBe("cliente");
    expect(quemEnviou({ direcao: "entrada", origem: "automacao", enviada_por: null })).toBe("empresa");
    expect(quemEnviou({ direcao: "saida", origem: "humano", enviada_por: "u-1" })).toBe("equipe");
    expect(quemEnviou({ direcao: "saida", origem: "ia", enviada_por: null })).toBe("assistente");
    expect(quemEnviou({ direcao: "saida", origem: "automacao", enviada_por: null })).toBe("automacao");
    expect(quemEnviou({ direcao: "saida", origem: "celular", enviada_por: null })).toBe("celular");
  });

  it("resumo de hoje separa recebidas, propaganda e enviadas por quem", () => {
    const r = resumoDoDia(
      [
        msg({ quando: "2026-10-08T12:00:00Z", origem: "humano" }),
        msg({ quando: "2026-10-08T12:05:00Z", origem: "automacao" }),
        msg({ quando: "2026-10-08T12:10:00Z", direcao: "saida", enviada_por: "u-1" }),
        msg({ quando: "2026-10-08T12:11:00Z", direcao: "saida", origem: "ia" }),
        // 23h de ontem em Macapá: não é hoje, mesmo sendo 08/10 em UTC.
        msg({ quando: "2026-10-08T02:00:00Z", origem: "humano" }),
      ],
      AGORA,
    );
    expect(r).toEqual({
      recebidas: 1,
      deEmpresas: 1,
      enviadas: 2,
      porQuem: { equipe: 1, celular: 0, assistente: 1, automacao: 0 },
    });
  });

  it("por dia: 7 linhas, propaganda fora, fora da janela ignorado", () => {
    const linhas = mensagensPorDia(
      [
        msg({ quando: "2026-10-06T17:35:00Z", origem: "humano" }),
        msg({ quando: "2026-10-06T13:46:00Z", origem: "automacao" }),
        msg({ quando: "2026-10-06T14:48:00Z", direcao: "saida", origem: "automacao" }),
        msg({ quando: "2026-09-20T12:00:00Z", origem: "humano" }),
      ],
      AGORA,
    );
    expect(linhas).toHaveLength(7);
    expect(linhas.find((l) => l.dia === "2026-10-06")).toMatchObject({ recebidas: 1, enviadas: 1 });
    expect(linhas.reduce((s, l) => s + l.recebidas + l.enviadas, 0)).toBe(2);
  });
});

describe("espera", () => {
  it("conta abertas por setor, esperando, atrasadas e a mais antiga", () => {
    const r = resumoDaEspera(
      [
        { id: "a", fila: "comercial", status: "aberta", aguardando_desde: "2026-10-08T12:50:00Z", responsavel_id: null },
        { id: "b", fila: "financeiro", status: "aberta", aguardando_desde: "2026-10-08T10:00:00Z", responsavel_id: "u-1" },
        { id: "c", fila: "comercial", status: "pendente", aguardando_desde: null, responsavel_id: "u-1" },
        { id: "d", fila: "comercial", status: "resolvida", aguardando_desde: "2026-10-01T10:00:00Z", responsavel_id: null },
      ],
      AGORA,
    );
    expect(r.abertas).toBe(3);
    expect(r.esperando).toBe(2);
    expect(r.atrasadas).toBe(1);
    expect(r.semResponsavel).toBe(1);
    expect(r.maisAntiga).toMatchObject({ id: "b", espera: { minutos: 180, nivel: "atrasada" } });
    expect(r.porSetor.find((s) => s.setor === "comercial")).toEqual({ setor: "comercial", abertas: 2, esperando: 1 });
    expect(r.porSetor.map((s) => s.setor)).toEqual(["comercial", "producao", "financeiro", "administrativo"]);
  });
});

describe("atendimentos e tempo de resposta", () => {
  it("mediana e média sobre os valores, não média de médias", () => {
    expect(tempos([])).toBeNull();
    expect(tempos([10, 2, 600])).toEqual({ n: 3, mediana: 10, media: 204 });
    expect(tempos([4, 8])).toEqual({ n: 2, mediana: 6, media: 6 });
  });

  it("hoje, em andamento, sem resposta; spam fora do tempo de resposta", () => {
    const r = resumoDosAtendimentos(
      [
        at({ aberto_em: "2026-10-08T12:00:00Z", primeira_resposta_em: "2026-10-08T12:10:00Z" }),
        at({ aberto_em: "2026-10-08T12:30:00Z" }),
        at({
          aberto_em: "2026-10-07T12:00:00Z",
          primeira_resposta_em: "2026-10-07T13:00:00Z",
          fechado_em: "2026-10-08T12:00:00Z",
          fechado_por: "u-1",
          motivo_resolucao: "atendido",
        }),
        at({
          aberto_em: "2026-10-06T11:34:00Z",
          fechado_em: "2026-10-08T03:17:00Z",
          fechado_por: "u-1",
          motivo_resolucao: "spam",
        }),
        // Antes da janela: não entra no tempo de resposta.
        at({ aberto_em: "2026-09-20T12:00:00Z", primeira_resposta_em: "2026-09-22T12:00:00Z", fechado_em: "2026-09-22T13:00:00Z", fechado_por: "u-1", motivo_resolucao: "atendido" }),
      ],
      AGORA,
    );
    expect(r.abertosHoje).toBe(2);
    expect(r.resolvidosHoje).toBe(2);
    expect(r.emAndamento).toBe(2);
    expect(r.semResposta).toBe(1);
    expect(r.motivos).toEqual({ atendido: 1, spam: 1 });
    expect(r.primeiraResposta).toEqual({ n: 2, mediana: 35, media: 35 });
  });

  it("por atendente: resolvidos, mensagens e 1ª resposta de cada um", () => {
    const nomes = new Map([
      ["u-1", "Harison"],
      ["u-2", "Leonardo"],
    ]);
    const inicio = inicioDaJanela(AGORA);
    const linhas = porAtendente(
      [
        at({ aberto_em: "2026-10-08T12:00:00Z", primeira_resposta_em: "2026-10-08T12:04:00Z", responsavel_id: "u-2" }),
        at({
          aberto_em: "2026-10-07T12:00:00Z",
          primeira_resposta_em: "2026-10-07T12:20:00Z",
          responsavel_id: "u-1",
          fechado_em: "2026-10-07T15:00:00Z",
          fechado_por: "u-1",
          motivo_resolucao: "atendido",
        }),
      ],
      [
        msg({ quando: "2026-10-08T12:04:00Z", direcao: "saida", enviada_por: "u-2" }),
        msg({ quando: "2026-10-08T12:06:00Z", direcao: "saida", enviada_por: "u-2" }),
        msg({ quando: "2026-09-01T12:06:00Z", direcao: "saida", enviada_por: "u-2" }),
        msg({ quando: "2026-10-08T12:07:00Z", direcao: "saida", origem: "ia" }),
      ],
      nomes,
      inicio,
    );
    expect(linhas).toEqual([
      { id: "u-1", nome: "Harison", resolvidos: 1, mensagens: 0, primeiraResposta: { n: 1, mediana: 20, media: 20 } },
      { id: "u-2", nome: "Leonardo", resolvidos: 0, mensagens: 2, primeiraResposta: { n: 1, mediana: 4, media: 4 } },
    ]);
  });
});

describe("leads e orçamentos da caixa", () => {
  it("lead com cliente conta como ganho", () => {
    expect(
      resumoDosLeads([
        { status: "novo", cliente_id: null },
        { status: "perdido", cliente_id: null },
        { status: "orcamento", cliente_id: "c-1" },
        { status: "ganho", cliente_id: null },
      ]),
    ).toEqual({ total: 4, emAberto: 1, ganhos: 2, perdidos: 1 });
  });

  it("orçamento convertido também é aprovado", () => {
    expect(resumoDosOrcamentos([{ status: "rascunho" }, { status: "aprovado" }, { status: "convertido" }])).toEqual({
      total: 3,
      aprovados: 2,
      emRascunho: 1,
    });
  });
});

describe("saúde da conexão", () => {
  const conectada = { status: "conectada", conectado: true, ativa: true };

  it("conectado com sinal recente: ok", () => {
    const s = saudeDaConexao([{ ...conectada, ultimo_evento_at: "2026-10-08T12:00:00Z" }], "2026-10-08T11:00:00Z", AGORA);
    expect(s).toMatchObject({ nivel: "ok", titulo: "Conectado" });
    expect(s.detalhe).toContain("Última mensagem de cliente há 2 h");
  });

  it("número quieto há mais de 48 h: atenção, com o que conferir — não 'fora do ar'", () => {
    const s = saudeDaConexao([{ ...conectada, ultimo_evento_at: "2026-10-05T12:00:00Z" }], "2026-10-05T11:00:00Z", AGORA);
    expect(s.nivel).toBe("atencao");
    expect(s.titulo).toBe("Conectado, sem sinal do Z-API há 3 d 1 h");
    expect(s.detalhe).toContain('webhook "Ao receber"');
  });

  it("desconectado ou sem instância: fora", () => {
    expect(saudeDaConexao([{ status: "desconectada", conectado: false, ativa: true, ultimo_evento_at: null }], null, AGORA)).toMatchObject({
      nivel: "fora",
      titulo: "WhatsApp desconectado",
    });
    expect(saudeDaConexao([], null, AGORA).nivel).toBe("fora");
    expect(saudeDaConexao([{ ...conectada, ativa: false, ultimo_evento_at: null }], null, AGORA).titulo).toBe(
      "Nenhum número conectado",
    );
  });
});
