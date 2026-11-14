/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any` e `from` fora dos tipos gerados: as funções do agente nascem na migração C3, aplicada à mão */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  linhaDoAgentePodeSair,
  rodarAgente,
  type PortaDoAgente,
  type ResultadoDoAgente,
} from "@/domain/agente/orquestrador";
import { triagemPodeFalarCom } from "@/domain/whatsapp/triagem/extrair";
import { lerTodasAsLinhas } from "@/domain/whatsapp/triagem/paginar";
import { lerTermosExtras } from "@/lib/api/termos-proibidos";

/**
 * O agente que ESCOLHE respostas aprovadas, do lado do servidor (C3).
 *
 * As regras moram em `src/domain/agente` (portão, casamento, decisão e o orquestrador); aqui só se entrega a PORTA de
 * verdade (as funções `agente_*` do banco, que só o service_role executa) e se cuida do que o servidor precisa saber de
 * si: o teto de tempo dentro do webhook e a conferência da fila.
 *
 * QUEM CHAMA
 *   whatsapp-webhook.server.ts    `agenteSemDerrubar`, depois da triagem e ANTES da assistente de texto livre;
 *   whatsapp-triagem.server.ts    `conferirLinhaDeTriagem`, quando a linha da fila traz `agente: true`, delega para
 *                                 `conferirLinhaDoAgente` (a mesma fila, a mesma chave `triagem:`, outra conferência);
 *   whatsapp-enviar.server.ts     `varrerAgenteSeLigado`, no começo da rodada do servidor.
 *
 * NASCE DESLIGADO: com `agente_config.estado = 'desligada'` a função lê essa linha e sai. Nenhuma função do banco é
 * chamada, nenhuma trava é pega. Mesmo padrão de `varrerTriagemSeLigada`.
 *
 * NUNCA DERRUBA o webhook: tudo em try/catch, com teto de tempo e rastro do estouro. A mensagem do contato já está
 * gravada quando isto roda. Nenhum texto de mensagem vai para log nem para evento: só etapa, código e contagem.
 *
 * O TEXTO QUE SAI não passa por aqui: este arquivo só diz ao banco QUAL resposta (id e versão). O banco lê o
 * `texto_aprovado` da linha, roda o validador de novo e enfileira.
 */

/** Teto do despacho imediato: o atraso de digitação do Z-API pode segurar a chamada. */
export const TEMPO_LIMITE_DO_DESPACHO_DO_AGENTE_MS = 20_000;
/** Folga para as idas ao banco (configuração, contexto, quadro, termos, registrar) e a gravação do rastro. */
export const FOLGA_DO_BANCO_DO_AGENTE_MS = 10_000;
/** Teto de tempo do agente inteiro dentro do webhook: despacho mais folga do banco. */
export const TEMPO_LIMITE_DO_AGENTE_MS =
  TEMPO_LIMITE_DO_DESPACHO_DO_AGENTE_MS + FOLGA_DO_BANCO_DO_AGENTE_MS;
/** Quanto esperar o rastro do estouro de tempo ser gravado antes de devolver o erro ao webhook. */
const TEMPO_DO_RASTRO_DO_ESTOURO_MS = 1_500;

type Db = typeof supabaseAdmin;

function lancar(erro: { message?: string; code?: string } | null): never {
  const e = new Error(erro?.message ?? "erro do banco") as Error & { code?: string };
  if (erro?.code) e.code = erro.code;
  throw e;
}

/** A porta de verdade. Exportada para o teste conferir o formato das chamadas ao banco. */
export function portaDoAgente(db: Db = supabaseAdmin): PortaDoAgente {
  return {
    async estadoDaConfiguracao() {
      const { data, error } = await (db as any)
        .from("agente_config")
        .select("estado")
        .maybeSingle();
      if (error) lancar(error);
      return (data as { estado?: string } | null)?.estado ?? null;
    },

    async lerContexto(conversaId, mensagemId) {
      const { data, error } = await (db.rpc as any)("agente_contexto", {
        p_conversa_id: conversaId,
        p_mensagem_id: mensagemId,
      });
      if (error) lancar(error);
      return data;
    },

    // o quadro de frases da triagem serve para ler a INTENÇÃO (parar, preço, cortesia, reclamação, robô): a mesma fonte
    async lerQuadro() {
      return lerTodasAsLinhas<Record<string, unknown>>((de, ate) =>
        (db as any)
          .from("whatsapp_triagem_respostas")
          .select("id, passo, intencao, frase, casamento")
          .eq("ativo", true)
          .order("id")
          .range(de, ate),
      );
    },

    lerTermos: () => lerTermosExtras(db),

    async registrar(conversaId, mensagemId, decisao) {
      const { data, error } = await (db.rpc as any)("agente_registrar", {
        p_conversa_id: conversaId,
        p_mensagem_id: mensagemId,
        p_decisao: decisao,
      });
      if (error) lancar(error);
      return data;
    },

    async despachar() {
      const { rodadaDoServidor } = await import("@/lib/api/whatsapp-enviar.server");
      let teto: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          rodadaDoServidor({ varrer: false }),
          new Promise<void>((resolve) => {
            teto = setTimeout(resolve, TEMPO_LIMITE_DO_DESPACHO_DO_AGENTE_MS);
          }),
        ]);
      } finally {
        if (teto) clearTimeout(teto);
      }
    },

    async registrarErro({ conversaId, mensagemId, etapa, codigo }) {
      // só etapa e código curto: a mensagem de erro do banco pode trazer valor de coluna
      await registrarEventoDoAgente(db, conversaId, mensagemId, "erro", { etapa, codigo });
    },

    agora: () => Date.now(),
  };
}

/** `agente_evento`: erro e pausado, só com códigos. Nunca lança. */
async function registrarEventoDoAgente(
  db: Db,
  conversaId: string,
  mensagemId: string | null,
  tipo: "erro" | "pausado",
  detalhe: Record<string, string>,
): Promise<void> {
  try {
    const { error } = await (db.rpc as any)("agente_evento", {
      p_conversa_id: conversaId,
      p_mensagem_id: mensagemId,
      p_tipo: tipo,
      p_detalhe: detalhe,
    });
    if (error) console.error("[agente] não gravou o evento", error.code ?? "");
  } catch {
    // o rastro é acessório
  }
}

/**
 * Para o webhook: roda o agente com teto de tempo e NUNCA lança. Devolve o que fez, para ir na resposta do webhook como
 * `agente`. Estouro de tempo: deixa o rastro (erro, etapa `tempo`) com tempo próprio e curto e devolve `erro/tempo`.
 */
export async function agenteSemDerrubar(
  conversaId: string,
  mensagemId: string,
  opcoes: { porta?: PortaDoAgente; limiteMs?: number; rastroMs?: number } = {},
): Promise<ResultadoDoAgente> {
  let teto: ReturnType<typeof setTimeout> | undefined;
  try {
    const porta = opcoes.porta ?? portaDoAgente();
    return await Promise.race([
      rodarAgente(porta, { conversaId, mensagemId }),
      new Promise<ResultadoDoAgente>((resolve) => {
        teto = setTimeout(() => {
          void deixarORastroDoTempo(porta, conversaId, mensagemId, opcoes.rastroMs).then(() =>
            resolve({ acao: "erro", etapa: "tempo" }),
          );
        }, opcoes.limiteMs ?? TEMPO_LIMITE_DO_AGENTE_MS);
      }),
    ]);
  } catch (e) {
    console.error("[agente]", e instanceof Error ? e.name : "erro");
    return { acao: "erro", etapa: "interno" };
  } finally {
    if (teto) clearTimeout(teto);
  }
}

async function deixarORastroDoTempo(
  porta: PortaDoAgente,
  conversaId: string,
  mensagemId: string,
  rastroMs = TEMPO_DO_RASTRO_DO_ESTOURO_MS,
): Promise<void> {
  let limite: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      porta.registrarErro({ conversaId, mensagemId, etapa: "tempo", codigo: "tempo" }),
      new Promise<void>((resolve) => {
        limite = setTimeout(resolve, rastroMs);
      }),
    ]);
  } catch {
    // nem o rastro do estouro pode derrubar o webhook
  } finally {
    if (limite) clearTimeout(limite);
  }
}

/* ------------------------------------------------------------------ */
/* O consumidor da fila                                                */
/* ------------------------------------------------------------------ */

export type ConferenciaDaLinhaDoAgente = { acao: "sai" | "cancela" | "adia"; motivo: string };

/**
 * Antes de despachar uma linha do agente (payload com `triagem_id` e `agente: true`): o agente continua ligado e
 * cobrindo esta conversa, ninguém da equipe entrou, o contato não pediu para parar e o telefone é um celular brasileiro?
 * Se não, cancela (e deixa o evento `pausado` com o motivo). Se não deu para ler, ADIA: a linha fica pendente para a
 * próxima rodada, porque cancelar por erro de leitura apagaria uma resposta boa e enviar às cegas é o que a conferência
 * existe para evitar.
 */
export async function conferirLinhaDoAgente(
  linha: { conversa_id: string | null; payload: Record<string, unknown> | null },
  db: Db = supabaseAdmin,
): Promise<ConferenciaDaLinhaDoAgente> {
  if (!linha.conversa_id || linha.payload?.agente !== true)
    return { acao: "cancela", motivo: "linha_sem_agente" };
  try {
    // a resposta e a versão que o agente gravou na linha: o banco confere se ainda estão aprovadas. Linha sem elas cancela (nulo)
    const respostaId =
      typeof linha.payload?.resposta_id === "string" ? linha.payload.resposta_id : null;
    const versao =
      typeof linha.payload?.versao === "number" && Number.isInteger(linha.payload.versao)
        ? linha.payload.versao
        : null;
    const [conferencia, conversa] = await Promise.all([
      (db.rpc as any)("agente_conferir_envio", {
        p_conversa_id: linha.conversa_id,
        p_resposta_id: respostaId,
        p_versao: versao,
      }),
      (db as any)
        .from("whatsapp_conversas")
        .select("telefone")
        .eq("id", linha.conversa_id)
        .maybeSingle(),
    ]);
    if (conferencia.error || conversa.error)
      return { acao: "adia", motivo: "leitura_da_conferencia" };
    const c = (conferencia.data ?? {}) as Record<string, unknown>;
    const telefone = (conversa.data as { telefone?: string | null } | null)?.telefone ?? null;
    const d = linhaDoAgentePodeSair({
      estado: typeof c.estado === "string" ? c.estado : null,
      triagemLiberou: c.triagem_liberou === true,
      degrauPermite: c.degrau_permite === true,
      humanoNaConversa: c.humano === true,
      bloqueado: c.bloqueado === true,
      respostaAprovada: c.resposta_aprovada === true,
      telefoneAlcancavel: triagemPodeFalarCom(telefone),
    });
    if (d.sai) return { acao: "sai", motivo: d.motivo };
    await registrarEventoDoAgente(db, linha.conversa_id, null, "pausado", { motivo: d.motivo });
    return { acao: "cancela", motivo: d.motivo };
  } catch {
    return { acao: "adia", motivo: "excecao" };
  }
}

/** A varredura do agente (freio por falhas de envio e retenção dos eventos). Nunca lança. */
export async function varrerAgente(db: Db = supabaseAdmin): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await (db.rpc as any)("agente_varrer", {});
    if (error) {
      console.error("[agente] varredura falhou", error.code ?? "");
      return { erro: true };
    }
    return (data ?? {}) as Record<string, unknown>;
  } catch {
    return { erro: true };
  }
}

/**
 * O que a rodada do despachante chama. Lê o estado da configuração ANTES (uma linha, barato) e só varre quando o agente
 * está ligado em algum degrau. DESLIGADO: a rodada não toca em mais nada (a fila do agente já foi cancelada por quem
 * desligou). Falha ao ler o estado não varre: o agente desligado não tem o que parar, e o freio roda na próxima rodada.
 */
export async function varrerAgenteSeLigado(
  db: Db = supabaseAdmin,
): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await (db as any).from("agente_config").select("estado").maybeSingle();
    if (error) return { pulada: true, motivo: "leitura_da_configuracao" };
    const estado = (data as { estado?: string } | null)?.estado ?? null;
    if (estado === null) return { pulada: true, motivo: "sem_configuracao" };
    if (estado === "desligada") return { pulada: true, motivo: "desligada" };
  } catch {
    return { pulada: true, motivo: "leitura_da_configuracao" };
  }
  return varrerAgente(db);
}
