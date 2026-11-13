/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: funções da triagem fora dos tipos gerados; é a forma que tests/rpc-assinaturas lê */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  assistentePodeResponder,
  CEP_PIOR_CASO_MS,
  ESPERA_MAXIMA_MS,
  linhaDeTriagemPodeSair,
  MOTIVO_SEM_NUMERO,
  rodarTriagem,
  type LinhaDeEntrada,
  type PortaDaTriagem,
  type ResultadoDaLigacao,
} from "@/domain/whatsapp/triagem/orquestrador";
import { triagemPodeFalarCom } from "@/domain/whatsapp/triagem/extrair";
import { consultarCepRapido } from "@/lib/api/cep.server";

/**
 * A triagem de boas-vindas do WhatsApp, do lado do servidor (Onda B, PR B5).
 *
 * As regras moram em `src/domain/whatsapp/triagem` (o motor puro e o
 * orquestrador); aqui só se entrega a PORTA de verdade (banco pelas funções
 * `triagem_*`, que só o service_role executa, e a consulta de CEP) e se cuida
 * do que o servidor precisa saber de si: o teto de tempo dentro do webhook.
 *
 * QUEM CHAMA
 *   whatsapp-webhook.server.ts   `triagemSemDerrubar`, depois de gravar a
 *                                mensagem e ANTES da assistente;
 *   whatsapp-assistente.server.ts `donoDaConversa`, a mesma fonte de "quem responde";
 *   whatsapp-enviar.server.ts    `conferirLinhaDeTriagem` e `cancelarFilaDaTriagem`
 *                                antes de despachar linha de triagem, e `varrerTriagemSeLigada`
 *                                no começo da rodada do servidor.
 *
 * NASCE DESLIGADA: com `whatsapp_triagem_config.estado = 'desligada'` a função
 * lê essa linha e sai. Nada é gravado, nenhuma trava é pega.
 *
 * NUNCA DERRUBA o webhook: tudo vai em try/catch, com teto de tempo (a soma do pior caso) e rastro
 * do estouro. A mensagem do contato já está gravada quando isto roda.
 *
 * PENDENTE (docs/ensaio-triagem-dados.md §8.1): o consumidor só envia por `whatsapp_conversas.telefone`; conversa
 * que só tem lid fica sem robô (a triagem a entrega à equipe e `conferirLinhaDeTriagem` cancela o que sobrar).
 * A limpeza dos eventos antigos e os avisos de grupo só rodam com a triagem ligada em algum degrau
 * (`varrerTriagemSeLigada`).
 */

/** Teto do despacho imediato: o atraso de digitação do Z-API pode segurar a chamada. */
export const TEMPO_LIMITE_DO_DESPACHO_MS = 20_000;
/** Folga para as quatro idas ao banco (configuração, abrir, entradas, aplicar) e a gravação do rastro. */
export const FOLGA_DO_BANCO_MS = 10_000;
/**
 * Teto de tempo da triagem inteira dentro do webhook: o PIOR CASO somado (espera do intervalo mínimo, mais a
 * consulta de CEP, mais o despacho imediato, mais a folga do banco). Um teto menor que a soma estoura em
 * conversa normal de envio real e perde o rastro justamente do caso lento.
 */
export const TEMPO_LIMITE_DA_TRIAGEM_MS =
  ESPERA_MAXIMA_MS + CEP_PIOR_CASO_MS + TEMPO_LIMITE_DO_DESPACHO_MS + FOLGA_DO_BANCO_MS;
/** Quanto esperar o rastro do estouro de tempo ser gravado antes de devolver o erro ao webhook. */
const TEMPO_DO_RASTRO_DO_ESTOURO_MS = 1_500;

type Db = typeof supabaseAdmin;

function lancar(erro: { message?: string; code?: string } | null): never {
  const e = new Error(erro?.message ?? "erro do banco") as Error & { code?: string };
  if (erro?.code) e.code = erro.code;
  throw e;
}

/** A porta de verdade. Exportada para o teste conferir o formato das chamadas ao banco. */
export function portaDaTriagem(db: Db = supabaseAdmin): PortaDaTriagem {
  return {
    async estadoDaConfiguracao() {
      const { data, error } = await (db as any)
        .from("whatsapp_triagem_config")
        .select("estado")
        .maybeSingle();
      if (error) lancar(error);
      return (data as { estado?: string } | null)?.estado ?? null;
    },

    async lerOuAbrir(conversaId, mensagemId, contexto) {
      const { data, error } = await (db.rpc as any)("triagem_ler_ou_abrir", {
        p_conversa_id: conversaId,
        p_mensagem_id: mensagemId,
        p_contexto: contexto,
      });
      if (error) lancar(error);
      return data;
    },

    async lerEntradas(ids) {
      const { data, error } = await (db as any)
        .from("whatsapp_mensagens")
        .select("id, tipo, texto, legenda, origem, recebido_em, created_at")
        .in("id", ids)
        .eq("direcao", "entrada");
      if (error) lancar(error);
      return ((data ?? []) as Record<string, unknown>[]).map(
        (m): LinhaDeEntrada => ({
          id: String(m.id),
          tipo: String(m.tipo),
          texto: (m.texto as string | null) ?? null,
          legenda: (m.legenda as string | null) ?? null,
          origem: (m.origem as string | null) ?? null,
          recebidaEm: ((m.recebido_em ?? m.created_at) as string | null) ?? null,
        }),
      );
    },

    async consultarCep(cep) {
      const d = await consultarCepRapido(cep);
      return d
        ? { cep: d.cep, rua: d.endereco, bairro: d.bairro, cidade: d.cidade, estado: d.estado }
        : null;
    },

    async aplicar(triagemId, versao, resultado) {
      const { data, error } = await (db.rpc as any)("triagem_aplicar", {
        p_triagem_id: triagemId,
        p_versao: versao,
        p_resultado: resultado,
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
            teto = setTimeout(resolve, TEMPO_LIMITE_DO_DESPACHO_MS);
          }),
        ]);
      } finally {
        if (teto) clearTimeout(teto);
      }
    },

    esperar: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),

    async registrarErro({ conversaId, mensagemId, etapa, codigo }) {
      // só etapa e código curto: a mensagem de erro do banco pode trazer valor de coluna
      const { error } = await (db as any).from("whatsapp_triagem_eventos").insert({
        conversa_id: conversaId,
        mensagem_id: mensagemId,
        tipo: "erro",
        detalhe: { etapa, codigo },
      });
      if (error) console.error("[whatsapp-triagem] não gravou o erro", error.code ?? "");
    },

    agora: () => Date.now(),
  };
}

/**
 * Para o webhook: roda a triagem com teto de tempo e NUNCA lança. Devolve o que
 * fez, para ir na resposta do webhook como `triagem`.
 *
 * Estouro de tempo: deixa o rastro (`registrarErro`, etapa e código `tempo`, que entra na contagem do freio de
 * erros por hora) e devolve `erro/tempo`. O rastro tem tempo próprio e curto: se o banco é a causa da lentidão, o
 * webhook não espera por ele.
 */
export async function triagemSemDerrubar(
  conversaId: string,
  mensagemId: string,
  opcoes: {
    ehGrupo?: boolean;
    porta?: PortaDaTriagem;
    limiteMs?: number;
    rastroMs?: number;
  } = {},
): Promise<ResultadoDaLigacao> {
  let teto: ReturnType<typeof setTimeout> | undefined;
  try {
    const porta = opcoes.porta ?? portaDaTriagem();
    return await Promise.race([
      rodarTriagem(porta, { conversaId, mensagemId, ehGrupo: opcoes.ehGrupo }),
      new Promise<ResultadoDaLigacao>((resolve) => {
        teto = setTimeout(() => {
          void deixarORastroDoTempo(porta, conversaId, mensagemId, opcoes.rastroMs).then(() =>
            resolve({ acao: "erro", etapa: "tempo" }),
          );
        }, opcoes.limiteMs ?? TEMPO_LIMITE_DA_TRIAGEM_MS);
      }),
    ]);
  } catch (e) {
    console.error("[whatsapp-triagem]", e instanceof Error ? e.name : "erro");
    return { acao: "erro", etapa: "interno" };
  } finally {
    if (teto) clearTimeout(teto);
  }
}

async function deixarORastroDoTempo(
  porta: PortaDaTriagem,
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
/* Quem responde: a mesma fonte para a triagem e para a assistente     */
/* ------------------------------------------------------------------ */

/** `triagem_dono_da_conversa`. Nulo quando a leitura falha: quem chama trata como silêncio. */
export async function donoDaConversa(
  conversaId: string,
  db: Db = supabaseAdmin,
): Promise<string | null> {
  try {
    const { data, error } = await (db.rpc as any)("triagem_dono_da_conversa", {
      p_conversa_id: conversaId,
    });
    if (error) return null;
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}

/** A assistente só responde quando o dono é ela. Erro de leitura é silêncio. */
export async function assistentePodeFalar(
  conversaId: string,
  db: Db = supabaseAdmin,
): Promise<{ pode: boolean; motivo: string }> {
  return assistentePodeResponder(await donoDaConversa(conversaId, db));
}

/** O horário de atendimento pela função única do banco (a mesma que a triagem usa). Nulo se a leitura falhar. */
export async function dentroDoHorarioPeloBanco(
  agora: Date,
  db: Db = supabaseAdmin,
): Promise<boolean | null> {
  try {
    const { data, error } = await (db.rpc as any)("whatsapp_dentro_do_horario", {
      p_momento: agora.toISOString(),
    });
    if (error || typeof data !== "boolean") return null;
    return data;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* O consumidor da fila                                                */
/* ------------------------------------------------------------------ */

export type ConferenciaDaLinha = { acao: "sai" | "cancela" | "adia"; motivo: string };

/**
 * Antes de despachar uma linha de triagem (payload com `triagem_id`): a triagem
 * continua valendo (ativa, ou já terminada com esta como mensagem final), o degrau
 * da escada ainda deixa esta conversa, ninguém da equipe entrou e o telefone é um
 * celular brasileiro? Se não, cancela. Se não deu para ler, ADIA (a linha fica
 * pendente para a próxima rodada): cancelar por erro de leitura apagaria uma
 * pergunta boa, e enviar às cegas é o que a conferência existe para evitar.
 *
 * A mensagem FINAL da triagem (fechamento, link de parceiro, aviso de equipe, aviso de
 * parar) é enfileirada na mesma transação que grava o status final; ver
 * `STATUS_TERMINAIS_QUE_FALAM`. Telefone com cara de lid cancela e deixa o evento `pulou`.
 */
export async function conferirLinhaDeTriagem(
  linha: { conversa_id: string | null; payload: Record<string, unknown> | null },
  db: Db = supabaseAdmin,
): Promise<ConferenciaDaLinha> {
  const triagemId = typeof linha.payload?.triagem_id === "string" ? linha.payload.triagem_id : null;
  if (!triagemId || !linha.conversa_id) return { acao: "cancela", motivo: "linha_sem_triagem" };
  try {
    const { data: t, error: e1 } = await (db as any)
      .from("whatsapp_triagens")
      .select("status, modo")
      .eq("id", triagemId)
      .maybeSingle();
    if (e1) return { acao: "adia", motivo: "leitura_da_triagem" };
    const modo = (t as { modo?: string } | null)?.modo ?? null;
    const status = (t as { status?: string } | null)?.status ?? null;
    const [degrau, humano, conversa] = await Promise.all([
      (db.rpc as any)("_triagem_degrau_permite", {
        p_conversa: linha.conversa_id,
        p_modo: modo ?? "real",
      }),
      (db.rpc as any)("_triagem_humano_na_conversa", { p_conversa: linha.conversa_id }),
      (db as any).from("whatsapp_conversas").select("telefone").eq("id", linha.conversa_id).maybeSingle(),
    ]);
    if (degrau.error || humano.error || conversa.error) {
      return { acao: "adia", motivo: "leitura_da_conferencia" };
    }
    const telefone = (conversa.data as { telefone?: string | null } | null)?.telefone ?? null;
    const d = linhaDeTriagemPodeSair({
      statusDaTriagem: status,
      modoDaTriagem: modo,
      degrauPermite: degrau.data === true,
      humanoNaConversa: humano.data === true,
      telefoneAlcancavel: triagemPodeFalarCom(telefone),
    });
    if (d.sai) return { acao: "sai", motivo: d.motivo };
    if (d.motivo === MOTIVO_SEM_NUMERO) await registrarPulo(db, triagemId, linha.conversa_id, d.motivo);
    return { acao: "cancela", motivo: d.motivo };
  } catch {
    return { acao: "adia", motivo: "excecao" };
  }
}

/** O rastro de uma linha que não saiu por falta de número: evento `pulou`, só com o motivo. Nunca lança. */
async function registrarPulo(db: Db, triagemId: string, conversaId: string, motivo: string): Promise<void> {
  try {
    const { error } = await (db as any).from("whatsapp_triagem_eventos").insert({
      triagem_id: triagemId,
      conversa_id: conversaId,
      tipo: "pulou",
      detalhe: { motivo },
    });
    if (error) console.error("[whatsapp-triagem] não gravou o pulo", error.code ?? "");
  } catch {
    // o rastro é acessório: a linha já será cancelada
  }
}

/** Cancela as linhas de triagem pendentes da conversa e apaga a mensagem pendente que nunca saiu. Devolve quantas. */
export async function cancelarFilaDaTriagem(
  conversaId: string,
  db: Db = supabaseAdmin,
): Promise<number> {
  const { data, error } = await (db.rpc as any)("_triagem_cancelar_pendentes", {
    p_conversa: conversaId,
  });
  if (error) lancar(error);
  return typeof data === "number" ? data : 0;
}

/**
 * A varredura da triagem (expira a que ficou sem resposta, cancela fila que
 * sobrou, aplica o freio e enfileira o aviso do grupo, tudo no banco). Roda a
 * cada rodada do despachante do servidor, sem cron novo. Nunca lança.
 */
export async function varrerTriagem(db: Db = supabaseAdmin): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await (db.rpc as any)("triagem_varrer", {});
    if (error) {
      console.error("[whatsapp-triagem] varredura falhou", error.code ?? "");
      return { erro: true };
    }
    return (data ?? {}) as Record<string, unknown>;
  } catch {
    return { erro: true };
  }
}

/**
 * O que a rodada do despachante chama. Lê o estado da configuração ANTES (uma linha, barato) e só varre quando a
 * triagem está ligada em algum degrau (ensaio, teste, parcial ou ligada). Com a triagem DESLIGADA a rodada não toca
 * em mais nada, como o webhook. Duas consequências, ambas aceitas e registradas em docs/ensaio-triagem-dados.md §8:
 *   - a limpeza dos eventos antigos (retenção) e os avisos de grupo ainda não enviados só rodam com a triagem ligada;
 *   - a exceção é a conversa que ficou ABERTA: o freio automático só muda a configuração e deixa para a varredura
 *     parar o resto (pausar as abertas e cancelar a fila). Desligada com triagem aberta a varredura roda, uma vez,
 *     até não sobrar nenhuma.
 * Falha ao ler o estado vale como "varrer": na dúvida, parar o que está aberto é o lado seguro.
 */
export async function varrerTriagemSeLigada(db: Db = supabaseAdmin): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await (db as any).from("whatsapp_triagem_config").select("estado").maybeSingle();
    if (!error) {
      const estado = (data as { estado?: string } | null)?.estado ?? null;
      if (estado === null) return { pulada: true, motivo: "sem_configuracao" };
      if (estado === "desligada") {
        const { data: abertas, error: erroAbertas } = await (db as any)
          .from("whatsapp_triagens")
          .select("id")
          .in("status", ["ativa", "ensaio", "expirada"])
          .limit(1);
        if (!erroAbertas && (abertas ?? []).length === 0) return { pulada: true, motivo: "desligada" };
      }
    }
  } catch {
    // não deu para ler: varre
  }
  return varrerTriagem(db);
}
