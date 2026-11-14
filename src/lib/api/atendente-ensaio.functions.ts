/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ProdutoParaIa } from "@/domain/orcamentos/orcamento-com-ia";
import {
  decidirAtendente,
  decisaoDoAudio,
  FERRAMENTA_DO_ATENDENTE,
  interpretarAtendente,
  mascararDados,
  montarPerguntaDoAtendente,
  turnosDaConversa,
  type DecisaoDoAtendente,
  type FalaDaConversa,
  type ItemDoAtendente,
  type TipoDaMensagem,
} from "@/domain/whatsapp/atendente";
import type { RegraDoBanco } from "@/domain/whatsapp/triagem/verificador";
import { lerTermosExtras } from "@/lib/api/termos-proibidos";
import { exigeQuemOrca, motorDaIa, produtosParaIa, type Motor } from "@/lib/api/orcamento-ia.functions";

/**
 * O atendente em ENSAIO: conversa, mas nada aqui fala com o cliente nem cria orçamento, e desde a C1 (14/11/2026) nem calcula
 * valor: a tabela de preços não é mais lida e a coluna `valor` do ensaio fica vazia. Nenhuma função deste
 * arquivo grava em `whatsapp_mensagens`, na fila de envio ou em `orcamentos`.
 */

const TEMPO_LIMITE_MS = 45_000;

export type RespostaDoEnsaio =
  | { estado: "ok"; decisao: DecisaoDoAtendente; itens: ItemDoAtendente[]; confianca: number | null }
  | { estado: "sem_ia" | "sem_roteiro" | "limite" | "sem_saldo" }
  | { estado: "falhou"; detalhe: string };

/** Uma resposta do atendente. Sem framework: é o que o teste exercita. */
export async function responderNoEnsaio(
  a: {
    historico: FalaDaConversa[];
    mensagem: string;
    tipo: TipoDaMensagem;
    produtos: ProdutoParaIa[];
    motor: Motor | null;
    /** Os termos que o dono acrescentou na tabela, além da lista do código. */
    extras?: readonly RegraDoBanco[];
  },
  buscar: typeof fetch = fetch,
): Promise<RespostaDoEnsaio> {
  // Áudio não vai para a IA: sem transcrição, ela responderia sem saber o que foi dito.
  if (a.tipo === "audio") return { estado: "ok", decisao: decisaoDoAudio(), itens: [], confianca: null };
  if (!a.motor) return { estado: "sem_ia" };
  if (a.produtos.length === 0) return { estado: "sem_roteiro" };
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resposta: Response;
  try {
    resposta = await buscar(a.motor.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${a.motor.chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: a.motor.modelo,
        messages: montarPerguntaDoAtendente(a.historico, a.mensagem, a.produtos),
        tools: [FERRAMENTA_DO_ATENDENTE],
        tool_choice: { type: "function", function: { name: FERRAMENTA_DO_ATENDENTE.function.name } },
      }),
      signal: controle.signal,
    });
  } catch {
    return { estado: "falhou", detalhe: "o serviço de IA não respondeu" };
  } finally {
    clearTimeout(limite);
  }
  if (resposta.status === 429) return { estado: "limite" };
  if (resposta.status === 402) return { estado: "sem_saldo" };
  if (!resposta.ok) return { estado: "falhou", detalhe: `o serviço de IA respondeu HTTP ${resposta.status}` };
  let corpo: any;
  try {
    corpo = await resposta.json();
  } catch {
    return { estado: "falhou", detalhe: "resposta da IA ilegível" };
  }
  const argumentos = corpo?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  const leitura = argumentos == null ? null : interpretarAtendente(argumentos, a.produtos);
  if (!leitura) return { estado: "falhou", detalhe: "a IA não respondeu no formato combinado" };
  return {
    estado: "ok",
    decisao: decidirAtendente(leitura, a.tipo, a.extras ?? []),
    itens: leitura.itens,
    confianca: leitura.confianca,
  };
}

/** A tela de ensaio: alguém da equipe escreve como cliente. */
export const ensaiarAtendimento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { historico: FalaDaConversa[]; mensagem: string; tipo?: TipoDaMensagem }) => ({
    historico: (Array.isArray(d?.historico) ? d.historico : []).slice(-30).map((h) => ({
      de: h?.de === "grafica" ? ("grafica" as const) : ("cliente" as const),
      texto: String(h?.texto ?? "").slice(0, 1000),
    })),
    mensagem: String(d?.mensagem ?? "").trim().slice(0, 2000),
    tipo: (d?.tipo ?? "texto") as TipoDaMensagem,
  }))
  .handler(async ({ data, context }): Promise<RespostaDoEnsaio> => {
    await exigeQuemOrca(context as any);
    const db = context.supabase as any;
    const produtos = await produtosParaIa(db);
    return responderNoEnsaio({
      historico: data.historico,
      mensagem: data.mensagem || `[${data.tipo} enviada]`,
      tipo: data.tipo,
      produtos,
      motor: motorDaIa(),
      extras: await lerTermosExtras(db),
    });
  });

/**
 * A réplica: passa UMA mensagem de uma conversa real pelo atendente e guarda o resultado ao lado do que a equipe
 * respondeu. A tela chama de turno em turno, porque várias chamadas de IA numa só passariam do tempo do servidor. Lê
 * com a permissão de quem pediu. Telefone, e-mail e documento saem mascarados antes de ir para a IA, e nada volta para
 * o cliente.
 */
export const repetirTurno = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversa_id: string; ordem: number }) => ({
    conversa_id: String(d?.conversa_id ?? ""),
    ordem: Math.max(Number(d?.ordem) || 0, 0),
  }))
  .handler(async ({ data, context }): Promise<{ total: number; falha: string | null }> => {
    await exigeQuemOrca(context as any);
    const db = context.supabase as any;
    const { data: mensagens, error } = await db
      .from("whatsapp_mensagens")
      .select("direcao, tipo, texto, legenda, created_at")
      .eq("conversa_id", data.conversa_id)
      .order("created_at")
      .limit(120);
    if (error) throw new Error("Não foi possível ler a conversa.");
    const turnos = turnosDaConversa((mensagens ?? []) as any[]);
    const t = turnos[data.ordem];
    if (!t) return { total: turnos.length, falha: null };
    const produtos = await produtosParaIa(db);
    const r = await responderNoEnsaio({
      historico: t.historico,
      mensagem: t.mensagem,
      tipo: t.tipo,
      produtos,
      motor: motorDaIa(),
      extras: await lerTermosExtras(db),
    });
    if (r.estado !== "ok") return { total: turnos.length, falha: r.estado === "falhou" ? r.detalhe : r.estado };
    const { error: erro, data: gravada } = await db
      .from("atendente_ensaios")
      .upsert(
        {
          conversa_id: data.conversa_id,
          ordem: data.ordem,
          mensagem_cliente: t.mensagem,
          tipo_mensagem: t.tipo,
          resposta_ia: mascararDados(r.decisao.texto),
          resposta_equipe: t.respostaDaEquipe,
          acao: r.decisao.acao,
          motivo: r.decisao.motivo,
          itens: r.itens,
          valor: null,
          confianca: r.confianca,
          avaliacao: null,
        },
        { onConflict: "conversa_id,ordem" },
      )
      .select("id");
    if (erro || !gravada?.length) return { total: turnos.length, falha: "o resultado não foi gravado" };
    return { total: turnos.length, falha: null };
  });
