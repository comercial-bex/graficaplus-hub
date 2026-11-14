/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: funções da caixa v3 fora dos tipos gerados; é a forma que tests/rpc-assinaturas lê */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { rotuloDe } from "@/domain/os/etapas";
import { assistentePodeFalar, dentroDoHorarioPeloBanco } from "@/lib/api/whatsapp-triagem.server";
import {
  CONFIG_PADRAO,
  FERRAMENTA_DO_ASSISTENTE,
  FRASE_DE_TRANSFERENCIA,
  comAssinatura,
  decidirAcao,
  interpretarDecisao,
  montarPergunta,
  motivoDeTextoReprovado,
  orcamentoParaContexto,
  osParaContexto,
  portaoDoAssistente,
  roteirosDaConversa,
  textoDaMensagem,
  verificarSaida,
  type ConfigAssistente,
  type ContextoDaConversa,
  type DecisaoDaIa,
} from "@/domain/whatsapp/assistente";
import type { RegraDoBanco } from "@/domain/whatsapp/triagem/verificador";
import { lerTermosExtras } from "@/lib/api/termos-proibidos";

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
 * REGRA DO DONO (C1, 14/11/2026): a assistente nunca cita preço, validade, prazo nem data, e nunca faz orçamento. O
 * contexto não traz valor nem data (a consulta nem lê essas colunas), e TODO texto que vira mensagem (resposta, aviso fora
 * do horário, frase de transferência) passa por `verificarSaida` (o verificador único da triagem, ramo cliente final, mais
 * os termos que o dono acrescentou na tabela) JÁ MONTADO, com a assinatura. Texto reprovado nunca é enfileirado: vira log
 * com o NOME da regra (nunca o texto) e a conversa passa para a equipe em silêncio. A barreira no banco
 * (`whatsapp_ia_enviar`, migração 20261115130000) confere o mesmo texto com o validador do banco e recusa o que o código
 * deixou passar; a recusa volta como `texto_reprovado_pela_barreira: <regras>` e segue o mesmo caminho do texto reprovado
 * aqui (nada enfileirado, conversa para a equipe). Ver docs/ensaio-barreira-ia-enviar.md.
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
 *
 * MOTOR: a OpenAI, com a chave da agência (`OPENAI_API_KEY`, a mesma do Bex
 * Lite) — decisão do dono em 08/10/2026: a assistente NÃO usa o saldo de IA do
 * Lovable. O modelo vem de `OPENAI_MODEL`; sem ele, `gpt-5-mini` (barato e bom
 * em português). Sem a chave, a assistente nem pode ser ligada no Monitor.
 */

const OPENAI = "https://api.openai.com/v1/chat/completions";
export const MODELO_PADRAO = "gpt-5-mini";
const TEMPO_LIMITE_IA_MS = 20_000;

/** O modelo em uso: `OPENAI_MODEL` ou o padrão. */
export function modeloDaIa(): string {
  return (process.env.OPENAI_MODEL ?? "").trim() || MODELO_PADRAO;
}

/** A chave da OpenAI do servidor — nunca sai daqui. */
export function chaveDaIa(): string | undefined {
  return (process.env.OPENAI_API_KEY ?? "").trim() || undefined;
}
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
    .select("numero, titulo, status, created_at")
    .or(filtroOrc)
    .order("created_at", { ascending: false })
    .limit(5);
  if (erroOrc) throw new Error(`falha ao ler os orçamentos: ${erroOrc.message}`);

  let os: ContextoDaConversa["os"] = [];
  if (conversa.cliente_id) {
    const { data: lista, error: erroOs } = await db
      .from("ordens_servico")
      .select("numero, titulo, status")
      .eq("cliente_id", conversa.cliente_id)
      .neq("status", "cancelado")
      .order("created_at", { ascending: false })
      .limit(5);
    if (erroOs) throw new Error(`falha ao ler as OS: ${erroOs.message}`);
    os = ((lista ?? []) as { numero: number; titulo: string | null; status: string }[]).map((o) =>
      osParaContexto({ numero: o.numero, titulo: o.titulo, etapa: rotuloDe(o.status) }),
    );
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

  // O roteiro do produto de que a conversa fala. Falha aqui não pode calar a assistente.
  const { data: fichas } = await db
    .from("produto_ficha")
    .select("ia_como_medir, ia_perguntas, produtos!inner(nome, ativo)")
    .eq("ia_habilitado", true)
    .eq("produtos.ativo", true);
  const { data: nova } = await db.from("whatsapp_mensagens").select("texto, legenda").eq("id", mensagemId).maybeSingle();
  const novaMensagem = nova as { texto?: string | null; legenda?: string | null } | null;
  const roteiros = roteirosDaConversa(
    [...historico.map((h) => h.texto), novaMensagem?.texto ?? "", novaMensagem?.legenda ?? ""].join(" "),
    ((fichas ?? []) as { ia_como_medir: string | null; ia_perguntas: string | null; produtos: { nome: string } }[]).map(
      (f) => ({ nome: f.produtos.nome, produto: f.produtos.nome, como_medir: f.ia_como_medir, perguntas: f.ia_perguntas }),
    ),
  );

  return {
    cliente,
    roteiros,
    orcamentos: ((orcs ?? []) as Parameters<typeof orcamentoParaContexto>[0][]).map((o) => orcamentoParaContexto(o)),
    os,
    historico,
    grafica: { endereco: config.endereco, horario: config.horario_texto },
  };
}

type RespostaDaIa =
  | { ok: true; decisao: DecisaoDaIa; tokensEntrada: number | null; tokensSaida: number | null }
  | { ok: false; erro: string };

/** Uma chamada à OpenAI (Chat Completions), com ferramenta obrigatória. */
export async function perguntarAIa(
  pergunta: ReturnType<typeof montarPergunta>,
  chave: string | undefined,
  buscar: typeof fetch = fetch,
  modelo: string = MODELO_PADRAO,
): Promise<RespostaDaIa> {
  if (!chave) return { ok: false, erro: "OPENAI_API_KEY não está nos segredos do projeto" };
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_IA_MS);
  let resposta: Response;
  try {
    resposta = await buscar(OPENAI, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelo,
        messages: pergunta,
        tools: [FERRAMENTA_DO_ASSISTENTE],
        tool_choice: { type: "function", function: { name: FERRAMENTA_DO_ASSISTENTE.function.name } },
        // Família gpt-5: raciocínio mínimo — resposta curta, mais rápida e mais barata.
        ...(modelo.startsWith("gpt-5") ? { reasoning_effort: "minimal" } : {}),
      }),
      signal: controle.signal,
    });
  } catch {
    return { ok: false, erro: "a OpenAI não respondeu a tempo" };
  } finally {
    clearTimeout(limite);
  }
  if (resposta.status === 401) return { ok: false, erro: "a OpenAI recusou a chave (HTTP 401)" };
  if (resposta.status === 404) {
    return { ok: false, erro: `o modelo ${modelo} não está disponível nesta conta da OpenAI (HTTP 404)` };
  }
  if (resposta.status === 429) return { ok: false, erro: "limite ou saldo da OpenAI esgotado (HTTP 429)" };
  if (!resposta.ok) return { ok: false, erro: `a OpenAI respondeu HTTP ${resposta.status}` };
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

/** O começo da mensagem com que a barreira do banco (`whatsapp_ia_enviar`) recusa um texto. Depois dele vêm só nomes de regra. */
export const PREFIXO_DA_BARREIRA = "texto_reprovado_pela_barreira:";

/**
 * As regras de uma recusa da barreira do banco, ou `null` se a mensagem de erro é de outra coisa. Só entram nomes de regra
 * (letras minúsculas, números e sublinhado): nada que pareça trecho de texto passa daqui para o log.
 */
export function regrasDaBarreira(mensagem: string | null | undefined): string[] | null {
  const m = String(mensagem ?? "");
  const i = m.indexOf(PREFIXO_DA_BARREIRA);
  if (i < 0) return null;
  const regras = m
    .slice(i + PREFIXO_DA_BARREIRA.length)
    .split(",")
    .map((r) => r.trim())
    .filter((r) => /^[a-z][a-z0-9_]{0,40}$/.test(r));
  return regras.length > 0 ? regras : ["barreira_do_banco"];
}

async function enviar(
  conversaId: string,
  texto: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; mensagemId: string } | { ok: false; regras: string[] }> {
  const { data, error } = await (supabaseAdmin.rpc as any)("whatsapp_ia_enviar", {
    p_conversa_id: conversaId,
    p_texto: texto,
    p_payload: payload,
  });
  if (error) {
    // O banco recusou o texto (o validador dele é mais estrito que o do código): é texto reprovado, não falha de infraestrutura.
    const regras = regrasDaBarreira(error.message);
    if (regras) return { ok: false, regras };
    throw new Error(`falha ao enfileirar a resposta: ${error.message}`);
  }
  return { ok: true, mensagemId: (data as { mensagem_id: string }).mensagem_id };
}

/**
 * A porta única de texto para o cliente: confere o texto JÁ MONTADO e só então enfileira. Reprovado: não enfileira, e o
 * log leva o nome da regra, nunca o texto.
 */
async function enviarVerificado(
  conversaId: string,
  texto: string,
  payload: Record<string, unknown>,
  extras: readonly RegraDoBanco[],
): Promise<{ enviado: true; mensagemId: string } | { enviado: false; regras: string[] }> {
  const regras = verificarSaida(texto, extras);
  if (regras.length > 0) return { enviado: false, regras };
  const envio = await enviar(conversaId, texto, payload);
  return envio.ok ? { enviado: true, mensagemId: envio.mensagemId } : { enviado: false, regras: envio.regras };
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
  opcoes: { agora?: Date; chave?: string; buscar?: typeof fetch; modelo?: string } = {},
): Promise<ResultadoDoAssistente> {
  const agora = opcoes.agora ?? new Date();
  // Os termos extras da tabela, lidos uma vez e só quando um texto vai ser conferido. Falha de leitura é lista vazia:
  // vale a lista do código, que nunca fica mais frouxa.
  let extrasLidos: RegraDoBanco[] | null = null;
  const termos = async (): Promise<RegraDoBanco[]> => (extrasLidos ??= await lerTermosExtras(supabaseAdmin));
  try {
    const config = await lerConfiguracao();
    if (!config.ia_ativa) return { acao: "nada", motivo: "ia_desligada" };

    // QUEM MANDA NA CONVERSA é uma fonte só, `triagem_dono_da_conversa` (13/11/2026). Triagem ativa, conversa que a triagem
    // já entregou à equipe, robô de empresa, grupo e contato bloqueado: a assistente não responde. Vale para o webhook e
    // para a reprocessagem manual (POST /api/whatsapp/agente), porque as duas passam por aqui. Erro de leitura é silêncio.
    const dono = await assistentePodeFalar(conversaId);
    if (!dono.pode) return { acao: "nada", motivo: dono.motivo };

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

    // O horário vem da função única do banco (whatsapp_dentro_do_horario, a mesma que a triagem usa). Se a leitura falhar,
    // vale a conta antiga sobre as colunas de whatsapp_configuracoes.
    const dentroPeloBanco = await dentroDoHorarioPeloBanco(agora);
    const portao = portaoDoAssistente({
      config,
      conversa,
      mensagem,
      ultimaRespostaIaEm: (ultimaIa as { created_at?: string } | null)?.created_at ?? null,
      agora,
      dentroDoHorario: dentroPeloBanco ?? undefined,
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
        const aviso = await enviarVerificado(
          conversaId,
          comAssinatura(config.mensagem_fora_horario, config.assinatura),
          { ia: { fora_horario: true } },
          await termos(),
        );
        if (aviso.enviado) avisouForaDoHorario = true;
        else {
          // O aviso configurado tem preço, prazo ou outro termo proibido: não sai, e a equipe assume em silêncio.
          const motivo = `aviso fora do horário: ${motivoDeTextoReprovado(aviso.regras)}`;
          await registrarLog({
            conversa_id: conversaId,
            mensagem_id: mensagemId,
            etapa: "resposta",
            saida: { aviso: "fora_horario", regras: aviso.regras, sem_mensagem: true },
            erro: motivo,
          });
          await transferir(conversaId, motivo);
        }
      }
    }

    const contexto = await montarContexto(conversa, config, mensagemId);
    const texto = textoDaMensagem(mensagem) || `[${mensagem.tipo}]`;
    const pergunta = montarPergunta(contexto, texto, config.assinatura);
    const inicio = Date.now();
    const modelo = opcoes.modelo ?? modeloDaIa();
    const ia = await perguntarAIa(pergunta, opcoes.chave ?? chaveDaIa(), opcoes.buscar, modelo);
    const duracao = Date.now() - inicio;

    if (!ia.ok) {
      await registrarLog({
        conversa_id: conversaId,
        mensagem_id: mensagemId,
        etapa: "classificacao",
        entrada: texto.slice(0, 2000),
        modelo,
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
      modelo,
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

    const extras = await termos();
    let acao = decidirAcao(decisao, contexto, extras);
    if (acao.tipo === "responder") {
      const envio = await enviarVerificado(
        conversaId,
        comAssinatura(acao.texto, config.assinatura),
        { ia: { intencao: decisao.intencao, confianca: decisao.confianca, log_id: logId } },
        extras,
      );
      if (envio.enviado) {
        await registrarLog({
          conversa_id: conversaId,
          mensagem_id: mensagemId,
          etapa: "resposta",
          entrada: acao.texto,
          saida: { mensagem_id: envio.mensagemId },
        });
        await despacharAgora();
        return { acao: "respondeu", mensagem_id: envio.mensagemId, intencao: decisao.intencao };
      }
      // A resposta passou, mas o texto montado (com a assinatura) não: transfere, sem enfileirar nada.
      acao = { tipo: "transferir", motivo: motivoDeTextoReprovado(envio.regras) };
    }

    const frase = await enviarVerificado(
      conversaId,
      comAssinatura(FRASE_DE_TRANSFERENCIA, config.assinatura),
      { ia: { intencao: decisao.intencao, confianca: decisao.confianca, log_id: logId, transferencia: true } },
      extras,
    );
    await transferir(conversaId, acao.motivo);
    await registrarLog({
      conversa_id: conversaId,
      mensagem_id: mensagemId,
      etapa: "transferencia",
      saida: frase.enviado
        ? { motivo: acao.motivo }
        : { motivo: acao.motivo, sem_mensagem: true, frase_reprovada_pelas_regras: frase.regras },
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
