import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { FaixaPreco } from "@/domain/orcamentos/faixas";
import {
  FERRAMENTA_DO_ORCAMENTO,
  interpretarLeitura,
  linhaDoItem,
  linhasDoAcabamento,
  montarPerguntaDoOrcamento,
  observacaoDoRascunho,
  precoDeTabela,
  type ItemDaIa,
  type LeituraDoPedido,
  type ProdutoParaIa,
  type ServicoDoAcabamento,
} from "@/domain/orcamentos/orcamento-com-ia";

/**
 * O orçamento com IA, do lado do servidor. As regras moram em
 * `src/domain/orcamentos/orcamento-com-ia.ts`.
 *
 * Fala só com a equipe: nada aqui manda mensagem ao cliente. O resultado é um
 * orçamento em RASCUNHO, que alguém confere antes de enviar.
 *
 * MOTOR: a chave da agência (`OPENAI_API_KEY`, a mesma da assistente do WhatsApp)
 * ou, sem ela, a IA do Lovable (`LOVABLE_API_KEY`). Sem nenhuma das duas, a tela diz
 * que a IA não está ligada no projeto.
 */

const TEMPO_LIMITE_MS = 30_000;
const PEDIDO_MAXIMO = 4000;

export type ResultadoDaLeitura =
  | { estado: "ok"; leitura: LeituraDoPedido }
  | { estado: "sem_ia" }
  | { estado: "sem_roteiro" }
  | { estado: "limite" }
  | { estado: "sem_saldo" }
  | { estado: "falhou"; detalhe: string };

type Motor = { url: string; chave: string; modelo: string };

function motorDaIa(): Motor | null {
  const openai = (process.env.OPENAI_API_KEY ?? "").trim();
  if (openai) {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      chave: openai,
      modelo: (process.env.OPENAI_MODEL ?? "").trim() || "gpt-5-mini",
    };
  }
  const lovable = (process.env.LOVABLE_API_KEY ?? "").trim();
  if (lovable) {
    return {
      url: "https://ai.gateway.lovable.dev/v1/chat/completions",
      chave: lovable,
      modelo: "google/gemini-2.5-flash",
    };
  }
  return null;
}

/** O coração da leitura, sem framework: é o que o teste exercita. */
export async function lerPedidoComIa(
  pedido: string,
  produtos: ProdutoParaIa[],
  motor: Motor | null,
  buscar: typeof fetch = fetch,
): Promise<ResultadoDaLeitura> {
  if (!motor) return { estado: "sem_ia" };
  if (produtos.length === 0) return { estado: "sem_roteiro" };
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resposta: Response;
  try {
    resposta = await buscar(motor.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${motor.chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: motor.modelo,
        messages: montarPerguntaDoOrcamento(pedido, produtos),
        tools: [FERRAMENTA_DO_ORCAMENTO],
        tool_choice: {
          type: "function",
          function: { name: FERRAMENTA_DO_ORCAMENTO.function.name },
        },
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
  if (!resposta.ok)
    return { estado: "falhou", detalhe: `o serviço de IA respondeu HTTP ${resposta.status}` };

  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    return { estado: "falhou", detalhe: "resposta da IA ilegível" };
  }
  const argumentos = (
    corpo as { choices?: { message?: { tool_calls?: { function?: { arguments?: unknown } }[] } }[] }
  )?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  const leitura = argumentos == null ? null : interpretarLeitura(argumentos, produtos);
  if (!leitura) return { estado: "falhou", detalhe: "a IA não respondeu no formato combinado" };
  return { estado: "ok", leitura };
}

async function exigeQuemOrca(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_permission", {
    _user_id: context.userId,
    _permission: "orcamentos.create",
  });
  if (error) throw new Error("Não foi possível conferir o seu perfil. Tente de novo.");
  if (!data) throw new Error("O orçamento com IA é de quem cria orçamentos.");
}

export const lerPedidoDoCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { pedido: string }) => ({
    pedido: String(d?.pedido ?? "")
      .trim()
      .slice(0, PEDIDO_MAXIMO),
  }))
  .handler(async ({ data, context }): Promise<ResultadoDaLeitura> => {
    await exigeQuemOrca(context as any);
    if (data.pedido.length < 5) return { estado: "falhou", detalhe: "Cole o pedido do cliente." };
    const { data: linhas, error } = await (context.supabase as any)
      .from("produto_ficha")
      .select(
        "produto_id, apelidos, ia_personalidade, ia_como_medir, ia_perguntas, produtos!inner(nome, unidade, tipo, ativo)",
      )
      .eq("ia_habilitado", true)
      .eq("produtos.ativo", true);
    if (error) throw new Error("Não foi possível ler os roteiros dos produtos.");
    const { data: ligacoes, error: erroLigacoes } = await (context.supabase as any)
      .from("produto_acabamentos")
      .select("produto_id, acabamentos!inner(nome, ativo)")
      .eq("acabamentos.ativo", true);
    if (erroLigacoes) throw new Error("Não foi possível ler os acabamentos dos produtos.");
    const acabamentosDe = (produtoId: string) =>
      ((ligacoes ?? []) as { produto_id: string; acabamentos: { nome: string } }[])
        .filter((l) => l.produto_id === produtoId)
        .map((l) => l.acabamentos.nome);
    const [tamanhos, definidas] = await Promise.all([
      (context.supabase as any)
        .from("produto_tamanhos")
        .select("produto_id, nome, largura, altura, quando_usar")
        .order("ordem"),
      (context.supabase as any)
        .from("produto_perguntas")
        .select("produto_id, pergunta, resposta_padrao")
        .eq("nao_perguntar", true),
    ]);
    if (tamanhos.error || definidas.error)
      throw new Error("Não foi possível ler os tamanhos e as perguntas dos produtos.");
    const produtos: ProdutoParaIa[] = ((linhas ?? []) as any[]).map((l) => ({
      id: l.produto_id,
      nome: l.produtos.nome,
      unidade: l.produtos.unidade,
      tipo: l.produtos.tipo,
      personalidade: l.ia_personalidade,
      como_medir: l.ia_como_medir,
      perguntas: l.ia_perguntas,
      acabamentos: acabamentosDe(l.produto_id),
      apelidos: l.apelidos ?? [],
      tamanhos: ((tamanhos.data ?? []) as any[])
        .filter((t) => t.produto_id === l.produto_id)
        .map((t) => ({
          nome: t.nome,
          largura: Number(t.largura),
          altura: Number(t.altura),
          quando_usar: t.quando_usar ?? null,
        })),
      ja_definido: ((definidas.data ?? []) as any[])
        .filter((q) => q.produto_id === l.produto_id)
        .map((q) => ({ pergunta: q.pergunta, resposta: q.resposta_padrao })),
    }));
    return lerPedidoComIa(data.pedido, produtos, motorDaIa());
  });

export const criarRascunhoDaIa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      contato_nome: string;
      contato_telefone?: string | null;
      pedido: string;
      leitura: LeituraDoPedido;
    }) => d,
  )
  .handler(async ({ data, context }): Promise<{ orcamento_id: string; falharam: string[] }> => {
    await exigeQuemOrca(context as any);
    const nome = String(data.contato_nome ?? "").trim();
    if (!nome) throw new Error("Diga o nome do cliente.");
    const itens: ItemDaIa[] = data.leitura?.itens ?? [];
    if (itens.length === 0) throw new Error("A leitura não trouxe nenhum produto do catálogo.");
    const db = context.supabase as any;

    // O preço vem da tabela, pela visão de preço de venda: nunca do que veio da tela ou da IA.
    const { data: precos, error: erroPrecos } = await db
      .from("produtos_comercial")
      .select("id, preco_base")
      .in(
        "id",
        itens.map((i) => i.produto_id),
      );
    if (erroPrecos) throw new Error("Não foi possível ler os preços dos produtos.");
    const precoDe = new Map(
      ((precos ?? []) as { id: string; preco_base: number | null }[]).map((p) => [
        p.id,
        p.preco_base,
      ]),
    );
    const { data: linhasDeFaixa, error: erroFaixas } = await db
      .from("produto_faixas_preco")
      .select("id, produto_id, quantidade_minima, preco_unitario, preco_m2_referencia, vigencia_inicio, vigencia_fim")
      .in("produto_id", itens.map((i) => i.produto_id));
    if (erroFaixas) throw new Error("Não foi possível ler as faixas de preço.");
    const faixasDe = (produtoId: string) =>
      ((linhasDeFaixa ?? []) as (FaixaPreco & { produto_id: string })[]).filter((f) => f.produto_id === produtoId);

    const { data: criado, error } = await db
      .from("orcamentos")
      .insert({
        contato_nome: nome,
        contato_telefone: String(data.contato_telefone ?? "").trim() || null,
        titulo: data.leitura.titulo,
        valor_total: 0,
        valor_subtotal: 0,
        observacao_interna: observacaoDoRascunho(data.leitura, data.pedido),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const falharam: string[] = [];
    // O serviço de cada acabamento pedido, com o preço da tabela.
    const nomesPedidos = [...new Set(itens.flatMap((i) => i.acabamentos ?? []))];
    let servicos: ServicoDoAcabamento[] = [];
    if (nomesPedidos.length > 0) {
      const { data: acab } = await db
        .from("acabamentos")
        .select("nome, produto_servico_id")
        .in("nome", nomesPedidos);
      const linhasDeAcab = (acab ?? []) as { nome: string; produto_servico_id: string | null }[];
      const { data: prods } = await db
        .from("produtos_comercial")
        .select("id, nome, unidade, preco_base")
        .in("id", linhasDeAcab.map((a) => a.produto_servico_id).filter(Boolean));
      const listaDeProdutos = (prods ?? []) as {
        id: string;
        nome: string;
        unidade: string | null;
        preco_base: number | null;
      }[];
      servicos = linhasDeAcab.flatMap((a) => {
        const p = listaDeProdutos.find((x) => x.id === a.produto_servico_id);
        return p ? [{ acabamento: a.nome, id: p.id, nome: p.nome, unidade: p.unidade, preco: p.preco_base }] : [];
      });
    }
    let proximaOrdem = itens.length;
    for (const [ordem, item] of itens.entries()) {
      const { data: linha, error: erroItem } = await db
        .from("orcamento_itens")
        .insert({
          orcamento_id: criado.id,
          ...linhaDoItem(item, precoDeTabela(item, precoDe.get(item.produto_id) ?? null, faixasDe(item.produto_id)), ordem),
        })
        .select("id");
      if (erroItem || !linha || linha.length === 0) falharam.push(item.nome);
      const { linhas: dosAcabamentos, pendentes } = linhasDoAcabamento(item, servicos);
      falharam.push(...pendentes);
      for (const l of dosAcabamentos) {
        const { data: criada, error: erroLinha } = await db
          .from("orcamento_itens")
          .insert({ orcamento_id: criado.id, ordem: proximaOrdem++, ...l })
          .select("id");
        if (erroLinha || !criada || criada.length === 0) falharam.push(l.descricao);
      }
    }
    return { orcamento_id: criado.id, falharam };
  });
