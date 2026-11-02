import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { FaixaPreco } from "@/domain/orcamentos/faixas";
import {
  camposDaCobranca,
  cobrancasDasRespostas,
  descricaoDaLinha,
  type LinhaDoOrcamento,
  type ProcessoDaResposta,
} from "@/domain/orcamentos/cobranca-das-respostas";
import {
  acabamentoAjustado,
  normalizarRespostas,
  perguntaDaLinha,
  processosDasRespostas,
  respostaDefinidaParaIa,
  type PerguntaDoProduto,
} from "@/domain/orcamentos/perguntas-do-item";
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

const COLUNAS_DA_PERGUNTA =
  "id, produto_id, pergunta, descricao, obrigatoria, tipo_resposta, respostas, acoes, ordem, resposta_padrao, nao_perguntar, ia_modo, ia_resposta, ia_instrucao";

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
    const [tamanhos, perguntas] = await Promise.all([
      (context.supabase as any)
        .from("produto_tamanhos")
        .select("produto_id, nome, largura, altura, quando_usar")
        .order("ordem"),
      (context.supabase as any)
        .from("produto_perguntas")
        .select(COLUNAS_DA_PERGUNTA)
        .order("ordem"),
    ]);
    if (tamanhos.error || perguntas.error)
      throw new Error("Não foi possível ler os tamanhos e as perguntas dos produtos.");
    const checklistDe = (produtoId: string) =>
      ((perguntas.data ?? []) as any[]).filter((q) => q.produto_id === produtoId).map(perguntaDaLinha);
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
      checklist: checklistDe(l.produto_id),
      ja_definido: checklistDe(l.produto_id).flatMap((q) => {
        const resposta = respostaDefinidaParaIa(q);
        return resposta === null ? [] : [{ pergunta: q.pergunta, resposta }];
      }),
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
    // O checklist vem do banco: a resposta que voltou da tela só vale se a pergunta é mesmo do produto.
    const { data: linhasDePergunta, error: erroPerguntas } = await db
      .from("produto_perguntas")
      .select(COLUNAS_DA_PERGUNTA)
      .in("produto_id", itens.map((i) => i.produto_id));
    if (erroPerguntas) throw new Error("Não foi possível ler as perguntas dos produtos.");
    const perguntasDe = (produtoId: string): PerguntaDoProduto[] =>
      ((linhasDePergunta ?? []) as any[]).filter((q) => q.produto_id === produtoId).map(perguntaDaLinha);
    const idsDeProcesso = [
      ...new Set(((linhasDePergunta ?? []) as any[]).flatMap((q) => ((q.acoes ?? []) as any[]).map((a) => a.processo_id))),
    ].filter(Boolean);
    const { data: linhasDeProcesso, error: erroProcessos } = idsDeProcesso.length
      ? await db.from("processos").select("id, nome, medida_cobrada, produto_servico_id").in("id", idsDeProcesso)
      : { data: [], error: null };
    if (erroProcessos) throw new Error("Não foi possível ler os processos das perguntas.");
    const processos = (linhasDeProcesso ?? []) as ProcessoDaResposta[];
    const idsDeServico = processos.map((p) => p.produto_servico_id).filter(Boolean);
    const { data: servicosDasRespostas, error: erroServicos } = idsDeServico.length
      ? await db.from("produtos_comercial").select("id, nome, unidade, preco_base").in("id", idsDeServico)
      : { data: [], error: null };
    if (erroServicos) throw new Error("Não foi possível ler os preços dos serviços.");

    let proximaOrdem = itens.length;
    const linhasDoOrcamento: LinhaDoOrcamento[] = [];
    for (const [ordem, item] of itens.entries()) {
      const perguntasDoItem = perguntasDe(item.produto_id);
      const ids = new Set(perguntasDoItem.map((q) => q.id));
      const respostas = normalizarRespostas(item.respostas).filter((r) => ids.has(r.pergunta_id));
      const nomesDosProcessos = processosDasRespostas(perguntasDoItem, respostas).flatMap((id) => {
        const p = processos.find((x) => x.id === id);
        return p ? [p.nome] : [];
      });
      const precoDoItem = precoDeTabela(item, precoDe.get(item.produto_id) ?? null, faixasDe(item.produto_id));
      // Sem preço vigente o item entra zerado: faixa vencida, quantidade abaixo da faixa ou peça da calculadora 3D.
      if (precoDoItem == null) falharam.push(`${item.nome}: sem preço de tabela para ${item.quantidade.toLocaleString("pt-BR")} ${item.unidade ?? "un"}`);
      const base = linhaDoItem({ ...item, respostas }, precoDoItem, ordem);
      const { data: linha, error: erroItem } = await db
        .from("orcamento_itens")
        .insert({
          orcamento_id: criado.id,
          ...base,
          acabamento: acabamentoAjustado(base.acabamento ?? "", [], nomesDosProcessos) || null,
        })
        .select("id, produto_id");
      if (erroItem || !linha || linha.length === 0) {
        falharam.push(item.nome);
        continue;
      }
      linhasDoOrcamento.push(linha[0]);
      const cobrados = new Set<string>();
      for (const c of cobrancasDasRespostas({
        perguntas: perguntasDoItem,
        respostas,
        processos,
        servicos: (servicosDasRespostas ?? []) as { id: string; nome: string; unidade: string }[],
        peca: { largura: item.largura_m ?? 0, altura: item.altura_m ?? 0, quantidade: item.quantidade },
        informadas: {},
        linhasDoOrcamento,
        itemAtualId: null,
      })) {
        if (c.estado === "falta_quantidade") falharam.push(`${c.nome} em ${item.nome}: informe a quantidade no item`);
        if (c.estado === "falta_medida") falharam.push(`${c.nome} em ${item.nome}: falta a medida para cobrar`);
        if (c.estado !== "cobra") continue;
        const { data: cobrada, error: erroCobranca } = await db
          .from("orcamento_itens")
          .insert({
            orcamento_id: criado.id,
            produto_id: c.servico!.id,
            descricao: descricaoDaLinha(c, item.nome),
            ...camposDaCobranca(c),
            ordem: proximaOrdem++,
            origem_calculo: "ia",
            gerado_por_item_id: linha[0].id,
          })
          .select("id, produto_id, gerado_por_item_id");
        if (erroCobranca || !cobrada || cobrada.length === 0) falharam.push(c.nome);
        else {
          linhasDoOrcamento.push(cobrada[0]);
          cobrados.add(c.servico!.id);
        }
      }
      const { linhas: dosAcabamentos, pendentes } = linhasDoAcabamento(item, servicos);
      falharam.push(...pendentes);
      // A IA pode marcar laminação como acabamento e também responder a pergunta: é uma cobrança só.
      for (const l of dosAcabamentos.filter((d) => !cobrados.has(d.produto_id))) {
        const { data: criada, error: erroLinha } = await db
          .from("orcamento_itens")
          .insert({ orcamento_id: criado.id, ordem: proximaOrdem++, ...l })
          .select("id");
        if (erroLinha || !criada || criada.length === 0) falharam.push(l.descricao);
      }
    }
    return { orcamento_id: criado.id, falharam };
  });
