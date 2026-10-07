/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: funções da caixa v3 fora dos tipos gerados; é a forma que tests/rpc-assinaturas lê */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { rotuloDe } from "@/domain/os/etapas";
import {
  CONFIG_PADRAO,
  FERRAMENTA_DO_ASSISTENTE,
  FRASE_DE_TRANSFERENCIA,
  comAssinatura,
  dataBR,
  decidirAcao,
  interpretarDecisao,
  montarPergunta,
  orcamentoParaContexto,
  portaoDoAssistente,
  textoDaMensagem,
  type ConfigAssistente,
  type ContextoDaConversa,
  type DecisaoDaIa,
} from "@/domain/whatsapp/assistente";

/**
 * A assistente de IA do WhatsApp, do lado do servidor. As regras moram em
 * `src/domain/whatsapp/assistente.ts`; aqui só se lê, chama a IA e grava.
 *
 * QUEM CHAMA: o webhook (`whatsapp-webhook.server.ts`), logo depois de gravar a
 * mensagem do cliente, DENTRO da mesma requisição e com tempo-limite
 * (`assistenteSemDerrubar`). "Disparar e esquecer" não serve: o servidor corta
 * o que sobra depois da resposta. E a rota POST /api/whatsapp/agente, com o
 * token do despachante, para reprocessar uma mensagem à mão.
 *
 * O QUE GRAVA, sempre pelas funções SECURITY DEFINER da caixa v3 (só
 * service_role): `whatsapp_ia_classificar` (etiqueta e fila),
 * `whatsapp_ia_enviar` (mensagem origem 'ia' + linha da fila de envio) e
 * `whatsapp_ia_transferir` (modo humano + espera). Cada decisão vira linha em
 * `whatsapp_ia_logs` — o painel "Decisões do assistente" do Monitor lê dali.
 *
 * SE A IA FALHA (sem chave, sem saldo, fora do ar, resposta ilegível): a
 * conversa vai para a equipe, sem mensagem ao cliente, e o motivo fica no log.
 * O cliente nunca fica sem ninguém olhando.
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODELO = "google/gemini-2.5-flash";
const TEMPO_LIMITE_IA_MS = 20_000;
/** Teto do assistente inteiro dentro do webhook. */
export const TEMPO_LIMITE_TOTAL_MS = 25_000;

export type ResultadoDoAssistente =
  | { acao: "nada"; motivo: string }
  | { acao: "classificou"; motivo: string; intencao?: string }
  | { acao: "respondeu"; mensagem_id: string; intencao: string }
  | { acao: "transferiu"; motivo: string }
  | { acao: "erro"; erro: string };

type Db = typeof supabaseAdmin;

/** Lê a configuração; linha ausente = padrão (desligada). */
export async function lerConfiguracao(db: Db = supabaseAdmin): Promise<ConfigAssistente> {
  const { data, error } = await (db as any)
    .from("whatsapp_configuracoes")
    .select(
      "ia_ativa, horario_inicio, horario_fim, dias_semana, mensagem_fora_horario, assinatura, endereco, horario_texto",
    )
    .maybeSingle();
  if (error) throw new Error(`falha ao ler a configuração do assistente: ${error.message}`);
  return data ? { ...CONFIG_PADRAO, ...(data as Partial<ConfigAssistente>) } : CONFIG_PADRAO;
}

async function registrarLog(
  linha: {
    conversa_id: string;
    mensagem_id: string | null;
    etapa: "classificacao" | "resposta" | "transferencia";
    entrada?: string | null;
    saida?: Record<string, unknown> | null;
    modelo?: string | null;
    tokens_entrada?: number | null;
    tokens_saida?: number | null;
    duracao_ms?: number | null;
    erro?: string | null;
  },
): Promise<string | null> {
  const { data, error } = await (supabaseAdmin as any)
    .from("whatsapp_ia_logs")
    .insert(linha)
    .select("id")
    .single();
  if (error) {
    console.error("[whatsapp-assistente] falha ao gravar o log", error.message);
    return null;
  }
  return (data as { id: string }).id;
}

async function montarContexto(
  conversa: { id: string; cliente_id: string | null; nome_contato: string | null; lead_id: string | null },
  config: ConfigAssistente,
  mensagemId: string,
): Promise<ContextoDaConversa> {
  const db = supabaseAdmin as any;
  let cliente: string | null = null;
  if (conversa.cliente_id) {
    const { data } = await db.from("clientes").select("nome").eq("id", conversa.cliente_id).maybeSingle();
    cliente = (data as { nome?: string } | null)?.nome ?? null;
  }
  if (!cliente && conversa.lead_id) {
    const { data } = await db.from("leads").select("nome").eq("id", conversa.lead_id).maybeSingle();
    cliente = (data as { nome?: string } | null)?.nome ?? null;
  }
  cliente = cliente ?? conversa.nome_contato ?? null;

  // Orçamentos desta conversa e, havendo cliente, os dele. Só os 5 mais novos.
  const filtroOrc = conversa.cliente_id
    ? `conversa_id.eq.${conversa.id},cliente_id.eq.${conversa.cliente_id}`
    : `conversa_id.eq.${conversa.id}`;
  const { data: orcs, error: erroOrc } = await db
    .from("orcamentos")
    .select("numero, titulo, status, valor_total, validade_dias, enviado_em, created_at")
    .or(filtroOrc)
    .order("created_at", { ascending: false })
    .limit(5);
  if (erroOrc) throw new Error(`falha ao ler os orçamentos: ${erroOrc.message}`);

  let os: ContextoDaConversa["os"] = [];
  if (conversa.cliente_id) {
    const { data: lista, error: erroOs } = await db
      .from("ordens_servico")
      .select("numero, titulo, status, prazo_entrega, prazo_cliente")
      .eq("cliente_id", conversa.cliente_id)
      .neq("status", "cancelado")
      .order("created_at", { ascending: false })
      .limit(5);
    if (erroOs) throw new Error(`falha ao ler as OS: ${erroOs.message}`);
    os = ((lista ?? []) as {
      numero: number;
      titulo: string | null;
      status: string;
      prazo_entrega: string | null;
      prazo_cliente: string | null;
    }[]).map((o) => ({
      numero: o.numero,
      titulo: o.titulo,
      etapa: rotuloDe(o.status),
      prazo: dataBR(o.prazo_cliente ?? o.prazo_entrega),
    }));
  }

  // As 10 mensagens anteriores à nova, para a IA entender o assunto.
  const { data: msgs, error: erroMsgs } = await db
    .from("whatsapp_mensagens")
    .select("id, direcao, texto, legenda, tipo, created_at")
    .eq("conversa_id", conversa.id)
    .neq("id", mensagemId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (erroMsgs) throw new Error(`falha ao ler a conversa: ${erroMsgs.message}`);
  const historico = ((msgs ?? []) as { direcao: string; texto: string | null; legenda: string | null; tipo: string }[])
    .reverse()
    .map((m) => ({
      de: m.direcao === "entrada" ? ("cliente" as const) : ("grafica" as const),
      texto: (m.texto ?? m.legenda ?? `[${m.tipo}]`).slice(0, 500),
    }));

  return {
    cliente,
    orcamentos: ((orcs ?? []) as Parameters<typeof orcamentoParaContexto>[0][]).map(orcamentoParaContexto),
    os,
    historico,
    grafica: { endereco: config.endereco, horario: config.horario_texto },
  };
}

type RespostaDaIa =
  | { ok: true; decisao: DecisaoDaIa; tokensEntrada: number | null; tokensSaida: number | null }
  | { ok: false; erro: string };

/** Uma chamada à IA do Lovable (AI Gateway), com ferramenta obrigatória. */
export async function perguntarAIa(
  pergunta: ReturnType<typeof montarPergunta>,
  chave: string | undefined,
  buscar: typeof fetch = fetch,
): Promise<RespostaDaIa> {
  if (!chave) return { ok: false, erro: "LOVABLE_API_KEY não está no servidor (IA do Lovable desligada)" };
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_IA_MS);
  let resposta: Response;
  try {
    resposta = await buscar(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELO,
        messages: pergunta,
        tools: [FERRAMENTA_DO_ASSISTENTE],
        tool_choice: { type: "function", function: { name: FERRAMENTA_DO_ASSISTENTE.function.name } },
      }),
      signal: controle.signal,
    });
  } catch {
    return { ok: false, erro: "o serviço de IA não respondeu a tempo" };
  } finally {
    clearTimeout(limite);
  }
  if (resposta.status === 402) return { ok: false, erro: "saldo de IA do Lovable acabou (HTTP 402)" };
  if (resposta.status === 429) return { ok: false, erro: "muitas chamadas seguidas à IA (HTTP 429)" };
  if (!resposta.ok) return { ok: false, erro: `o serviço de IA respondeu HTTP ${resposta.status}` };
  let corpo: any;
  try {
    corpo = await resposta.json();
  } catch {
    return { ok: false, erro: "resposta da IA ilegível" };
  }
  const argumentos = corpo?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  const decisao = interpretarDecisao(argumentos);
  if (!decisao) return { ok: false, erro: "a IA não respondeu no formato combinado" };
  return {
    ok: true,
    decisao,
    tokensEntrada: Number.isFinite(corpo?.usage?.prompt_tokens) ? corpo.usage.prompt_tokens : null,
    tokensSaida: Number.isFinite(corpo?.usage?.completion_tokens) ? corpo.usage.completion_tokens : null,
  };
}

async function enviar(conversaId: string, texto: string, payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await (supabaseAdmin.rpc as any)("whatsapp_ia_enviar", {
    p_conversa_id: conversaId,
    p_texto: texto,
    p_payload: payload,
  });
  if (error) throw new Error(`falha ao enfileirar a resposta: ${error.message}`);
  return (data as { mensagem_id: string }).mensagem_id;
}

async function transferir(conversaId: string, motivo: string): Promise<void> {
  const { error } = await (supabaseAdmin.rpc as any)("whatsapp_ia_transferir", {
    p_conversa_id: conversaId,
    p_motivo: motivo,
  });
  if (error) throw new Error(`falha ao transferir para a equipe: ${error.message}`);
}

/** Leva a fila agora (a resposta da assistente não espera o job de 2 min). */
async function despacharAgora(): Promise<void> {
  try {
    const { rodadaDoServidor } = await import("@/lib/api/whatsapp-enviar.server");
    await rodadaDoServidor();
  } catch (e) {
    // A mensagem já está na fila: o despachante seguinte leva. Só registra.
    console.error("[whatsapp-assistente] falha ao despachar agora", e instanceof Error ? e.message : e);
  }
}

/** A conversa ainda está livre? Alguém pode ter assumido enquanto a IA pensava. */
async function aindaLivre(conversaId: string): Promise<boolean> {
  const { data } = await (supabaseAdmin as any)
    .from("whatsapp_conversas")
    .select("modo, responsavel_id")
    .eq("id", conversaId)
    .maybeSingle();
  const c = data as { modo?: string; responsavel_id?: string | null } | null;
  return !!c && c.modo === "auto" && !c.responsavel_id;
}

/**
 * O assistente para UMA mensagem recebida. Nunca lança: devolve o que fez.
 */
export async function rodarAssistente(
  conversaId: string,
  mensagemId: string,
  opcoes: { agora?: Date; chave?: string; buscar?: typeof fetch } = {},
): Promise<ResultadoDoAssistente> {
  const agora = opcoes.agora ?? new Date();
  try {
    const config = await lerConfiguracao();
    if (!config.ia_ativa) return { acao: "nada", motivo: "ia_desligada" };

    const db = supabaseAdmin as any;
    const { data: conversa, error: erroConversa } = await db
      .from("whatsapp_conversas")
      .select("id, modo, responsavel_id, status, cliente_id, lead_id, nome_contato, atendimento_ativo_id")
      .eq("id", conversaId)
      .maybeSingle();
    if (erroConversa) throw new Error(`falha ao ler a conversa: ${erroConversa.message}`);
    if (!conversa) return { acao: "nada", motivo: "conversa não encontrada" };

    const { data: mensagem, error: erroMensagem } = await db
      .from("whatsapp_mensagens")
      .select("id, direcao, origem, tipo, texto, legenda, atendimento_id")
      .eq("id", mensagemId)
      .maybeSingle();
    if (erroMensagem) throw new Error(`falha ao ler a mensagem: ${erroMensagem.message}`);
    if (!mensagem) return { acao: "nada", motivo: "mensagem não encontrada" };

    const { data: ultimaIa } = await db
      .from("whatsapp_mensagens")
      .select("created_at")
      .eq("conversa_id", conversaId)
      .eq("origem", "ia")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const portao = portaoDoAssistente({
      config,
      conversa,
      mensagem,
      ultimaRespostaIaEm: (ultimaIa as { created_at?: string } | null)?.created_at ?? null,
      agora,
    });
    if (!portao.age) return { acao: "nada", motivo: portao.motivo };

    // Fora do horário: um aviso por atendimento, antes de classificar.
    let avisouForaDoHorario = false;
    if (!portao.responde && portao.motivo === "fora_do_horario") {
      const atendimento: string | null =
        (mensagem as { atendimento_id?: string | null }).atendimento_id ?? conversa.atendimento_ativo_id ?? null;
      const { data: jaAvisou } = atendimento
        ? await db
            .from("whatsapp_mensagens")
            .select("id")
            .eq("conversa_id", conversaId)
            .eq("origem", "ia")
            .eq("atendimento_id", atendimento)
            .eq("payload->ia->>fora_horario", "true")
            .limit(1)
            .maybeSingle()
        : { data: { id: "sem-atendimento" } };
      if (!jaAvisou) {
        await enviar(conversaId, comAssinatura(config.mensagem_fora_horario, config.assinatura), {
          ia: { fora_horario: true },
        });
        avisouForaDoHorario = true;
      }
    }

    const contexto = await montarContexto(conversa, config, mensagemId);
    const texto = textoDaMensagem(mensagem) || `[${mensagem.tipo}]`;
    const pergunta = montarPergunta(contexto, texto, config.assinatura);
    const inicio = Date.now();
    const ia = await perguntarAIa(pergunta, opcoes.chave ?? process.env.LOVABLE_API_KEY, opcoes.buscar);
    const duracao = Date.now() - inicio;

    if (!ia.ok) {
      await registrarLog({
        conversa_id: conversaId,
        mensagem_id: mensagemId,
        etapa: "classificacao",
        entrada: texto.slice(0, 2000),
        modelo: MODELO,
        duracao_ms: duracao,
        erro: ia.erro,
      });
      // A equipe assume: o cliente não fica sem ninguém olhando.
      if (portao.responde) {
        await transferir(conversaId, `assistente indisponível: ${ia.erro}`);
        await registrarLog({
          conversa_id: conversaId,
          mensagem_id: mensagemId,
          etapa: "transferencia",
          saida: { motivo: `assistente indisponível: ${ia.erro}`, sem_mensagem: true },
        });
      }
      if (avisouForaDoHorario) await despacharAgora();
      return { acao: "erro", erro: ia.erro };
    }

    const decisao = ia.decisao;
    const logId = await registrarLog({
      conversa_id: conversaId,
      mensagem_id: mensagemId,
      etapa: "classificacao",
      entrada: texto.slice(0, 2000),
      saida: { ...decisao, portao: portao.responde ? "responde" : portao.motivo },
      modelo: MODELO,
      tokens_entrada: ia.tokensEntrada,
      tokens_saida: ia.tokensSaida,
      duracao_ms: duracao,
    });

    const { error: erroClassificar } = await (supabaseAdmin.rpc as any)("whatsapp_ia_classificar", {
      p_conversa_id: conversaId,
      p_intencao: decisao.intencao,
      p_fila: decisao.fila_sugerida,
    });
    if (erroClassificar) throw new Error(`falha ao classificar: ${erroClassificar.message}`);

    if (!portao.responde) {
      if (avisouForaDoHorario) await despacharAgora();
      return { acao: "classificou", motivo: portao.motivo, intencao: decisao.intencao };
    }

    if (!(await aindaLivre(conversaId))) {
      return { acao: "classificou", motivo: "alguém da equipe assumiu enquanto a IA pensava", intencao: decisao.intencao };
    }

    const acao = decidirAcao(decisao, contexto);
    if (acao.tipo === "responder") {
      const id = await enviar(conversaId, comAssinatura(acao.texto, config.assinatura), {
        ia: { intencao: decisao.intencao, confianca: decisao.confianca, log_id: logId },
      });
      await registrarLog({
        conversa_id: conversaId,
        mensagem_id: mensagemId,
        etapa: "resposta",
        entrada: acao.texto,
        saida: { mensagem_id: id },
      });
      await despacharAgora();
      return { acao: "respondeu", mensagem_id: id, intencao: decisao.intencao };
    }

    await enviar(conversaId, comAssinatura(FRASE_DE_TRANSFERENCIA, config.assinatura), {
      ia: { intencao: decisao.intencao, confianca: decisao.confianca, log_id: logId, transferencia: true },
    });
    await transferir(conversaId, acao.motivo);
    await registrarLog({
      conversa_id: conversaId,
      mensagem_id: mensagemId,
      etapa: "transferencia",
      saida: { motivo: acao.motivo },
    });
    await despacharAgora();
    return { acao: "transferiu", motivo: acao.motivo };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error("[whatsapp-assistente]", erro);
    await registrarLog({ conversa_id: conversaId, mensagem_id: mensagemId, etapa: "classificacao", erro });
    return { acao: "erro", erro };
  }
}

/**
 * Para o webhook: roda o assistente com teto de tempo e NUNCA lança — a
 * mensagem do cliente já está gravada, e o 200 ao Z-API não depende disto.
 */
export async function assistenteSemDerrubar(conversaId: string, mensagemId: string): Promise<ResultadoDoAssistente> {
  let teto: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      rodarAssistente(conversaId, mensagemId),
      new Promise<ResultadoDoAssistente>((resolve) => {
        teto = setTimeout(
          () => resolve({ acao: "erro", erro: `assistente passou de ${TEMPO_LIMITE_TOTAL_MS / 1000} s` }),
          TEMPO_LIMITE_TOTAL_MS,
        );
      }),
    ]);
  } catch (e) {
    return { acao: "erro", erro: e instanceof Error ? e.message : String(e) };
  } finally {
    if (teto) clearTimeout(teto);
  }
}
