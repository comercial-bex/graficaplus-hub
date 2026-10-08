import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A assistente de IA exercida pelo servidor, com o banco, o despachante e a
 * IA trocados por dublês. O que se segura:
 *   - conversa com responsável: nem lê contexto, nem chama a IA, nem grava;
 *   - resposta boa: whatsapp_ia_enviar com assinatura + despacho na hora;
 *   - valor inventado: vira transferência (frase + whatsapp_ia_transferir);
 *   - IA fora do ar: transfere SEM mensagem ao cliente, com o motivo no log.
 */

const banco = vi.hoisted(() => {
  type Chamada = { tabela: string; metodo: string; args: unknown[] };
  const estado = {
    conversa: null as Record<string, unknown> | null,
    mensagem: null as Record<string, unknown> | null,
    config: null as Record<string, unknown> | null,
    orcamentos: [] as Record<string, unknown>[],
    ultimaIa: null as Record<string, unknown> | null,
    rpcs: [] as { nome: string; params: Record<string, unknown> | undefined }[],
    logs: [] as Record<string, unknown>[],
    leituras: [] as string[],
    from(tabela: string) {
      const chamadas: Chamada[] = [];
      let verbo = "select";
      let inserido: unknown = null;
      const cadeia: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "eq", "neq", "or", "order", "limit", "maybeSingle", "single", "in"]) {
        cadeia[m] = (...args: unknown[]) => {
          if (m === "insert" || m === "update") {
            verbo = m;
            inserido = args[0];
          }
          chamadas.push({ tabela, metodo: m, args });
          return cadeia;
        };
      }
      const tem = (metodo: string, a0?: unknown, a1?: unknown) =>
        chamadas.some(
          (c) => c.metodo === metodo && (a0 === undefined || c.args[0] === a0) && (a1 === undefined || c.args[1] === a1),
        );
      cadeia.then = (resolve: (v: unknown) => unknown) => {
        estado.leituras.push(tabela);
        let data: unknown = null;
        if (tabela === "whatsapp_ia_logs" && verbo === "insert") {
          estado.logs.push(inserido as Record<string, unknown>);
          data = { id: `log-${estado.logs.length}` };
        } else if (tabela === "whatsapp_configuracoes") data = estado.config;
        else if (tabela === "whatsapp_conversas") data = estado.conversa;
        else if (tabela === "whatsapp_mensagens") {
          if (tem("eq", "origem", "ia")) data = estado.ultimaIa;
          else if (tem("neq", "id")) data = [];
          else data = estado.mensagem;
        } else if (tabela === "orcamentos") data = estado.orcamentos;
        else if (tabela === "ordens_servico") data = [];
        else if (tabela === "clientes") data = { nome: "Max Lima" };
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return cadeia;
    },
    rpc(nome: string, params?: Record<string, unknown>) {
      estado.rpcs.push({ nome, params });
      return Promise.resolve({ data: nome === "whatsapp_ia_enviar" ? { mensagem_id: "m-ia" } : { ok: true }, error: null });
    },
  };
  return estado;
});

const despacho = vi.hoisted(() => ({ vezes: 0 }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => banco.from(t), rpc: (n: string, p?: Record<string, unknown>) => banco.rpc(n, p) },
}));
vi.mock("@/lib/api/whatsapp-enviar.server", () => ({
  rodadaDoServidor: async () => {
    despacho.vezes += 1;
    return new Response("{}");
  },
}));

import { rodarAssistente } from "@/lib/api/whatsapp-assistente.server";

const QUARTA_10H = new Date("2026-10-07T13:00:00Z");

function iaResponde(decisao: Record<string, unknown>): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(decisao) } }] } }],
        usage: { prompt_tokens: 900, completion_tokens: 60 },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
}

const decisaoBoa = {
  intencao: "orcamento",
  urgencia: "normal",
  resumo: "quer saber do orçamento 70",
  fila_sugerida: "comercial",
  confianca: 0.92,
  acao: "responder",
  resposta: "Olá, Max! O orçamento 70 está aprovado, no valor de R$ 30,60.",
};

beforeEach(() => {
  banco.conversa = {
    id: "c-1",
    modo: "auto",
    responsavel_id: null,
    status: "aberta",
    cliente_id: "cli-1",
    lead_id: null,
    nome_contato: "Max",
    atendimento_ativo_id: "at-1",
  };
  banco.mensagem = { id: "m-1", direcao: "entrada", origem: null, tipo: "texto", texto: "e o orçamento 70?", legenda: null, atendimento_id: "at-1" };
  banco.config = { ia_ativa: true, horario_inicio: "08:00:00", horario_fim: "18:00:00", dias_semana: [1, 2, 3, 4, 5], assinatura: "Bex Print · assistente" };
  banco.orcamentos = [
    { numero: 70, titulo: "banner cantinho", status: "aprovado", valor_total: 30.6, validade_dias: 7, enviado_em: null, created_at: "2026-10-05T12:00:00Z" },
  ];
  banco.ultimaIa = null;
  banco.rpcs = [];
  banco.logs = [];
  banco.leituras = [];
  despacho.vezes = 0;
});

describe("a assistente pelo servidor", () => {
  it("com responsável definido: não chama a IA, não lê contexto, não grava nada", async () => {
    banco.conversa = { ...banco.conversa, responsavel_id: "u-harison", modo: "humano" };
    let chamouIa = false;
    const r = await rodarAssistente("c-1", "m-1", {
      agora: QUARTA_10H,
      chave: "k",
      buscar: (async () => {
        chamouIa = true;
        return new Response("{}");
      }) as unknown as typeof fetch,
    });
    expect(r).toEqual({ acao: "nada", motivo: "com_responsavel" });
    expect(chamouIa).toBe(false);
    expect(banco.rpcs).toEqual([]);
    expect(banco.logs).toEqual([]);
    expect(banco.leituras).not.toContain("orcamentos");
  });

  it("desligada: nem lê a conversa", async () => {
    banco.config = { ia_ativa: false };
    const r = await rodarAssistente("c-1", "m-1", { agora: QUARTA_10H, chave: "k", buscar: iaResponde(decisaoBoa) });
    expect(r).toEqual({ acao: "nada", motivo: "ia_desligada" });
    expect(banco.leituras).toEqual(["whatsapp_configuracoes"]);
  });

  it("resposta com dado do banco: classifica, envia com assinatura e despacha na hora", async () => {
    const r = await rodarAssistente("c-1", "m-1", { agora: QUARTA_10H, chave: "k", buscar: iaResponde(decisaoBoa) });
    expect(r).toMatchObject({ acao: "respondeu", intencao: "orcamento" });
    expect(banco.rpcs.map((x) => x.nome)).toEqual(["whatsapp_ia_classificar", "whatsapp_ia_enviar"]);
    const envio = banco.rpcs[1].params as { p_texto: string; p_payload: { ia: { log_id: string } } };
    expect(envio.p_texto).toBe(`*Bex Print · assistente*\n${decisaoBoa.resposta}`);
    expect(envio.p_payload.ia.log_id).toBe("log-1");
    expect(banco.logs.map((l) => l.etapa)).toEqual(["classificacao", "resposta"]);
    expect(banco.logs[0]).toMatchObject({ tokens_entrada: 900, tokens_saida: 60 });
    expect(despacho.vezes).toBe(1);
  });

  it("valor inventado: manda a frase de passagem e transfere com o motivo", async () => {
    const r = await rodarAssistente("c-1", "m-1", {
      agora: QUARTA_10H,
      chave: "k",
      buscar: iaResponde({ ...decisaoBoa, resposta: "Fica R$ 99,00." }),
    });
    expect(r.acao).toBe("transferiu");
    expect(banco.rpcs.map((x) => x.nome)).toEqual(["whatsapp_ia_classificar", "whatsapp_ia_enviar", "whatsapp_ia_transferir"]);
    expect((banco.rpcs[1].params as { p_texto: string }).p_texto).toContain("Vou chamar alguém da equipe");
    expect(String((banco.rpcs[2].params as { p_motivo: string }).p_motivo)).toContain("R$ 99,00");
  });

  it("rajada (respondeu há 10 s): só classifica", async () => {
    banco.ultimaIa = { created_at: new Date(QUARTA_10H.getTime() - 10_000).toISOString() };
    const r = await rodarAssistente("c-1", "m-1", { agora: QUARTA_10H, chave: "k", buscar: iaResponde(decisaoBoa) });
    expect(r).toMatchObject({ acao: "classificou", motivo: "rajada" });
    expect(banco.rpcs.map((x) => x.nome)).toEqual(["whatsapp_ia_classificar"]);
    expect(despacho.vezes).toBe(0);
  });

  it("IA fora do ar: a equipe assume, sem mensagem ao cliente, e o motivo fica no log", async () => {
    const r = await rodarAssistente("c-1", "m-1", {
      agora: QUARTA_10H,
      chave: "k",
      buscar: (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch,
    });
    expect(r).toEqual({ acao: "erro", erro: "limite ou saldo da OpenAI esgotado (HTTP 429)" });
    expect(banco.rpcs.map((x) => x.nome)).toEqual(["whatsapp_ia_transferir"]);
    expect(banco.logs[0]).toMatchObject({ etapa: "classificacao", erro: "limite ou saldo da OpenAI esgotado (HTTP 429)" });
  });

  it("motor é a OpenAI, com a chave da agência — nunca o gateway do Lovable", async () => {
    const pedidos: { url: string; corpo: Record<string, unknown>; auth: string }[] = [];
    const espia = (async (url: string, init: RequestInit) => {
      pedidos.push({
        url,
        corpo: JSON.parse(String(init.body)),
        auth: String((init.headers as Record<string, string>).Authorization),
      });
      return iaResponde(decisaoBoa)(url, init);
    }) as unknown as typeof fetch;
    await rodarAssistente("c-1", "m-1", { agora: QUARTA_10H, chave: "sk-teste", buscar: espia, modelo: "gpt-5-mini" });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(pedidos[0].url).not.toContain("lovable");
    expect(pedidos[0].auth).toBe("Bearer sk-teste");
    expect(pedidos[0].corpo).toMatchObject({ model: "gpt-5-mini", reasoning_effort: "minimal" });
    expect(banco.logs[0]).toMatchObject({ modelo: "gpt-5-mini" });
  });

  it("modelo fora da família gpt-5 não recebe reasoning_effort", async () => {
    let corpo: Record<string, unknown> = {};
    const espia = (async (_url: string, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      return iaResponde(decisaoBoa)(_url, init);
    }) as unknown as typeof fetch;
    await rodarAssistente("c-1", "m-1", { agora: QUARTA_10H, chave: "sk-teste", buscar: espia, modelo: "gpt-4.1-mini" });
    expect(corpo.model).toBe("gpt-4.1-mini");
    expect(corpo).not.toHaveProperty("reasoning_effort");
  });

  it("sem OPENAI_API_KEY: mesma coisa, com o motivo dito", async () => {
    const r = await rodarAssistente("c-1", "m-1", { agora: QUARTA_10H, chave: "", buscar: iaResponde(decisaoBoa) });
    expect(r.acao).toBe("erro");
    expect(banco.rpcs.map((x) => x.nome)).toEqual(["whatsapp_ia_transferir"]);
  });
});
