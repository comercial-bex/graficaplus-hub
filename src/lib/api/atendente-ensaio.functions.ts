/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acabamentoCobravel } from "@/domain/orcamentos/cobranca-do-acabamento";
import type { FaixaPreco } from "@/domain/orcamentos/faixas";
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
  type TabelaDoAtendente,
  type TipoDaMensagem,
} from "@/domain/whatsapp/atendente";
import { exigeQuemOrca, motorDaIa, produtosParaIa, type Motor } from "@/lib/api/orcamento-ia.functions";

/**
 * O atendente em ENSAIO: conversa e calcula, mas nada aqui fala com o cliente nem cria orçamento. Nenhuma função deste
 * arquivo grava em `whatsapp_mensagens`, na fila de envio ou em `orcamentos`.
 */

const TEMPO_LIMITE_MS = 45_000;

export type RespostaDoEnsaio =
  | { estado: "ok"; decisao: DecisaoDoAtendente; itens: ItemDoAtendente[]; confianca: number | null }
  | { estado: "sem_ia" | "sem_roteiro" | "limite" | "sem_saldo" }
  | { estado: "falhou"; detalhe: string };

/** O preço de tudo que a conversa pode citar: produto, faixa, serviço de resposta e de acabamento. */
async function tabelaDoAtendente(db: any, produtos: ProdutoParaIa[]): Promise<TabelaDoAtendente> {
  const [precos, faixas, processos, acabamentos, servicos] = await Promise.all([
    db.from("produtos_comercial").select("id, preco_base, area_minima_cobrada"),
    db
      .from("produto_faixas_preco")
      .select("id, produto_id, quantidade_minima, preco_unitario, preco_m2_referencia, vigencia_inicio, vigencia_fim"),
    db.from("processos").select("id, nome, medida_cobrada, produto_servico_id"),
    db.from("acabamentos").select("nome, produto_servico_id").eq("ativo", true),
    db.from("produtos_comercial").select("id, nome, unidade, preco_base").eq("tipo", "servico"),
  ]);
  for (const r of [precos, faixas, processos, acabamentos, servicos]) {
    if (r.error) throw new Error("Não foi possível ler a tabela de preços.");
  }
  const mapa: TabelaDoAtendente["precos"] = new Map();
  for (const p of produtos) {
    const linha = (precos.data ?? []).find((x: any) => x.id === p.id);
    mapa.set(p.id, {
      preco_base: linha?.preco_base == null ? null : Number(linha.preco_base),
      area_minima: linha?.area_minima_cobrada == null ? null : Number(linha.area_minima_cobrada),
      faixas: ((faixas.data ?? []) as (FaixaPreco & { produto_id: string })[]).filter((f) => f.produto_id === p.id),
    });
  }
  const dosAcabamentos: TabelaDoAtendente["acabamentos"] = new Map();
  for (const a of (acabamentos.data ?? []) as { nome: string; produto_servico_id: string | null }[]) {
    const regra = acabamentoCobravel(a.nome);
    const s = (servicos.data ?? []).find((x: any) => x.id === a.produto_servico_id);
    if (regra && s) {
      dosAcabamentos.set(a.nome, { id: s.id, nome: s.nome, medida: regra.medida, preco: s.preco_base == null ? null : Number(s.preco_base) });
    }
  }
  return {
    precos: mapa,
    processos: (processos.data ?? []) as TabelaDoAtendente["processos"],
    servicos: (servicos.data ?? []) as TabelaDoAtendente["servicos"],
    acabamentos: dosAcabamentos,
  };
}

/** Uma resposta do atendente. Sem framework: é o que o teste exercita. */
export async function responderNoEnsaio(
  a: {
    historico: FalaDaConversa[];
    mensagem: string;
    tipo: TipoDaMensagem;
    produtos: ProdutoParaIa[];
    tabela: TabelaDoAtendente;
    motor: Motor | null;
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
    decisao: decidirAtendente(leitura, a.produtos, a.tabela, a.tipo),
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
      tabela: await tabelaDoAtendente(db, produtos),
      motor: motorDaIa(),
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
      tabela: await tabelaDoAtendente(db, produtos),
      motor: motorDaIa(),
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
          valor: r.decisao.previa?.total ?? null,
          confianca: r.confianca,
          avaliacao: null,
        },
        { onConflict: "conversa_id,ordem" },
      )
      .select("id");
    if (erro || !gravada?.length) return { total: turnos.length, falha: "o resultado não foi gravado" };
    return { total: turnos.length, falha: null };
  });
