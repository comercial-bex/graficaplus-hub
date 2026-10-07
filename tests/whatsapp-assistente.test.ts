import { describe, expect, it } from "vitest";
import {
  CONFIG_PADRAO,
  FERRAMENTA_DO_ASSISTENTE,
  comAssinatura,
  decidirAcao,
  dentroDoHorario,
  interpretarDecisao,
  montarPergunta,
  motivoParaBarrar,
  orcamentoParaContexto,
  portaoDoAssistente,
  type ContextoDaConversa,
  type DecisaoDaIa,
} from "@/domain/whatsapp/assistente";

/**
 * A assistente de IA da caixa (07/10/2026). O que se segura aqui:
 *   - ela não fala com conversa que tem gente atendendo (responsável ou modo humano);
 *   - rajada: respondeu há menos de 30 s, só classifica;
 *   - fora do horário só classifica (o aviso único é do servidor);
 *   - a resposta que cita valor ou data fora do banco NÃO sai — vira transferência.
 */

// Terça, 07/10/2026, 10:00 em Macapá (UTC−3) = 13:00 UTC.
const TERCA_10H = new Date("2026-10-07T13:00:00Z");
const DOMINGO_10H = new Date("2026-10-11T13:00:00Z");
const TERCA_20H = new Date("2026-10-07T23:00:00Z");

const ligada = { ...CONFIG_PADRAO, ia_ativa: true };
const conversaLivre = { modo: "auto", responsavel_id: null, status: "aberta" };
const msg = { direcao: "entrada", origem: null, tipo: "texto", texto: "Bom dia, meu banner já ficou pronto?", legenda: null };

function portao(over: Partial<Parameters<typeof portaoDoAssistente>[0]> = {}) {
  return portaoDoAssistente({
    config: ligada,
    conversa: conversaLivre,
    mensagem: msg,
    ultimaRespostaIaEm: null,
    agora: TERCA_10H,
    ...over,
  });
}

describe("horário comercial, no fuso de Macapá", () => {
  it("terça 10h está dentro; terça 20h e domingo, fora", () => {
    expect(dentroDoHorario(CONFIG_PADRAO, TERCA_10H)).toBe(true);
    expect(dentroDoHorario(CONFIG_PADRAO, TERCA_20H)).toBe(false);
    expect(dentroDoHorario(CONFIG_PADRAO, DOMINGO_10H)).toBe(false);
  });

  it("o fim é exclusivo: 18:00 já é fora", () => {
    expect(dentroDoHorario(CONFIG_PADRAO, new Date("2026-10-07T20:59:00Z"))).toBe(true);
    expect(dentroDoHorario(CONFIG_PADRAO, new Date("2026-10-07T21:00:00Z"))).toBe(false);
  });
});

describe("portões: quando a assistente fica quieta", () => {
  it("desligada (o padrão) não faz nada — nem gasta IA", () => {
    expect(portao({ config: CONFIG_PADRAO })).toEqual({ age: false, motivo: "ia_desligada" });
  });

  it("NÃO responde quando a conversa tem responsável", () => {
    expect(portao({ conversa: { ...conversaLivre, responsavel_id: "u-1" } })).toEqual({
      age: false,
      motivo: "com_responsavel",
    });
  });

  it("não responde em modo humano (a equipe assumiu ou ela transferiu)", () => {
    expect(portao({ conversa: { ...conversaLivre, modo: "humano" } })).toEqual({
      age: false,
      motivo: "modo_humano",
    });
  });

  it("mensagem de modelo de empresa (origem automacao) e saída não chamam a IA", () => {
    expect(portao({ mensagem: { ...msg, origem: "automacao" } })).toMatchObject({ age: false });
    expect(portao({ mensagem: { ...msg, direcao: "saida" } })).toMatchObject({ age: false });
  });

  it("rajada: respondeu há 20 s → só classifica; há 31 s → responde", () => {
    expect(portao({ ultimaRespostaIaEm: new Date(TERCA_10H.getTime() - 20_000).toISOString() })).toEqual({
      age: true,
      responde: false,
      motivo: "rajada",
    });
    expect(portao({ ultimaRespostaIaEm: new Date(TERCA_10H.getTime() - 31_000).toISOString() })).toEqual({
      age: true,
      responde: true,
    });
  });

  it("mídia sem texto só classifica; legenda conta como texto", () => {
    expect(portao({ mensagem: { ...msg, tipo: "imagem", texto: null } })).toMatchObject({ motivo: "so_midia" });
    expect(portao({ mensagem: { ...msg, tipo: "imagem", texto: null, legenda: "assim" } })).toEqual({
      age: true,
      responde: true,
    });
  });

  it("fora do horário só classifica", () => {
    expect(portao({ agora: TERCA_20H })).toEqual({ age: true, responde: false, motivo: "fora_do_horario" });
  });
});

const contexto: ContextoDaConversa = {
  cliente: "Max Lima",
  orcamentos: [
    orcamentoParaContexto({
      numero: 70,
      titulo: "banner cantinho",
      status: "aprovado",
      valor_total: 30.6,
      validade_dias: 7,
      enviado_em: "2026-10-05T12:00:00Z",
      created_at: "2026-10-05T12:00:00Z",
    }),
    orcamentoParaContexto({
      numero: 74,
      titulo: "banner de vende-se",
      status: "rascunho",
      valor_total: 20,
      validade_dias: 7,
      enviado_em: null,
      created_at: "2026-10-06T12:00:00Z",
    }),
  ],
  os: [{ numero: 12, titulo: "banner cantinho", etapa: "Em produção", prazo: "10/10/2026" }],
  historico: [],
  grafica: { endereco: null, horario: null },
};

const base: DecisaoDaIa = {
  intencao: "acompanhamento_os",
  urgencia: "normal",
  resumo: "quer saber do banner",
  fila_sugerida: "producao",
  confianca: 0.9,
  acao: "responder",
  resposta: "Olá, Max! A OS 12 está em produção, com previsão para 10/10.",
  motivo_transferencia: "",
};

describe("o contexto não entrega o que não é do cliente", () => {
  it("rascunho não leva valor; aprovado leva o valor em reais", () => {
    expect(contexto.orcamentos[0].valor).toBe("R$ 30,60");
    expect(contexto.orcamentos[1].valor).toBeNull();
    expect(contexto.orcamentos[1].status).toBe("em preparação");
  });

  it("a pergunta leva as regras, os dados e a mensagem nova", () => {
    const p = montarPergunta(contexto, "meu banner ficou pronto?", "Bex Print · assistente");
    expect(p[0].content).toContain("Nunca invente preço");
    expect(p[1].content).toContain('"numero":70');
    expect(p[1].content).toContain("meu banner ficou pronto?");
    expect(FERRAMENTA_DO_ASSISTENTE.function.parameters.required).toContain("acao");
  });
});

describe("as travas depois da IA", () => {
  it("resposta com prazo que está no banco sai", () => {
    expect(decidirAcao(base, contexto)).toEqual({ tipo: "responder", texto: base.resposta });
  });

  it("valor inventado vira transferência", () => {
    const a = decidirAcao({ ...base, resposta: "Fica R$ 45,00 o banner." }, contexto);
    expect(a.tipo).toBe("transferir");
    expect(motivoParaBarrar("Fica R$ 30,60, como combinado.", contexto)).toBeNull();
  });

  it("data inventada vira transferência", () => {
    expect(decidirAcao({ ...base, resposta: "Fica pronto dia 15/10." }, contexto)).toMatchObject({
      tipo: "transferir",
    });
  });

  it("financeiro, desconto e confiança baixa sempre vão para a equipe", () => {
    expect(decidirAcao({ ...base, intencao: "financeiro" }, contexto)).toEqual({
      tipo: "transferir",
      motivo: "assunto financeiro",
    });
    expect(decidirAcao({ ...base, resposta: "Consigo um desconto para você." }, contexto).tipo).toBe("transferir");
    expect(decidirAcao({ ...base, confianca: 0.4 }, contexto)).toMatchObject({ tipo: "transferir" });
  });

  it("pedido de transferência da IA é respeitado, com o motivo dela", () => {
    expect(
      decidirAcao({ ...base, acao: "transferir", motivo_transferencia: "cliente pediu atendente" }, contexto),
    ).toEqual({ tipo: "transferir", motivo: "cliente pediu atendente" });
  });
});

describe("leitura do que a IA devolve", () => {
  it("aceita string JSON ou objeto; recusa fora do combinado", () => {
    expect(interpretarDecisao(JSON.stringify(base))).toMatchObject({ intencao: "acompanhamento_os" });
    expect(interpretarDecisao({ ...base, intencao: "venda" })).toBeNull();
    expect(interpretarDecisao("isso não é json")).toBeNull();
  });

  it("confiança é limitada entre 0 e 1", () => {
    expect(interpretarDecisao({ ...base, confianca: 7 })?.confianca).toBe(1);
  });

  it("a mensagem leva a assinatura em negrito", () => {
    expect(comAssinatura("Olá!", "Bex Print · assistente")).toBe("*Bex Print · assistente*\nOlá!");
  });
});
