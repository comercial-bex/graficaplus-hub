/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas e funções do catálogo não estão nos tipos gerados */
import { supabase } from "@/integrations/supabase/client";
import {
  COLUNAS_DA_FOTO,
  COLUNAS_DA_MODALIDADE,
  COLUNAS_DA_SECAO,
  COLUNAS_DO_ITEM,
  itemDaLinha,
  numeroOuNulo,
  type FotoDoAcervo,
  type ItemDoCatalogo,
  type PrecosDoCatalogo,
  type SecaoDoCatalogo,
} from "@/domain/catalogo/itens";
import type { RegrasDeVenda } from "@/domain/catalogo/preco-de-venda";
import type { LinkDaVitrine } from "@/domain/catalogo/link-do-catalogo";
import type { Modalidade } from "@/domain/catalogo/modalidades";

/**
 * As leituras e as chamadas da tela de catálogos.
 *
 * DUAS REGRAS DESTA BASE QUE VALEM AQUI:
 *
 * 1. Erro é erro. Toda leitura confere `error` e lança — quem chama mostra
 *    "não deu para carregar", nunca uma grade vazia. Grade vazia por falha
 *    leva a gestão a importar o catálogo de novo, em dobro.
 *
 * 2. O PostgREST corta em 1.000 linhas, calado. A LUGA sozinha tem 933 itens,
 *    1.796 opções de preço e 766 fotos. Toda lista aqui é lida em páginas, com
 *    a contagem exata pedida na primeira: se o servidor cortar abaixo de 1.000,
 *    o laço continua até bater a contagem, em vez de parar achando que acabou.
 */

const PAGINA = 1000;

type Pagina = { data: unknown[] | null; error: unknown; count?: number | null };

async function lerTudo<T>(montar: (de: number, ate: number) => PromiseLike<Pagina>): Promise<T[]> {
  const saida: T[] = [];
  let total: number | null = null;
  for (let de = 0; ; de += PAGINA) {
    const { data, error, count } = await montar(de, de + PAGINA - 1);
    if (error) throw error;
    if (total === null && typeof count === "number") total = count;
    const lote = (data ?? []) as T[];
    saida.push(...lote);
    if (lote.length === 0) break;
    if (total !== null ? saida.length >= total : lote.length < PAGINA) break;
  }
  if (total !== null && saida.length !== total) {
    throw new Error(`A leitura veio pela metade (${saida.length} de ${total}). Recarregue a página.`);
  }
  return saida;
}

export type CatalogoDoFornecedor = {
  id: string;
  titulo: string;
  edicao: string | null;
  fornecedor_id: string;
  fornecedor: string;
  importado_em: string | null;
  sincronizado_em: string | null;
  ativo: boolean;
};

export async function lerCatalogo(id: string): Promise<CatalogoDoFornecedor> {
  const { data, error } = await (supabase as any)
    .from("fornecedor_catalogos")
    .select("id, titulo, edicao, fornecedor_id, importado_em, sincronizado_em, ativo, fornecedores(nome)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Catálogo não encontrado — ou você não tem acesso a ele.");
  return {
    id: data.id,
    titulo: data.titulo,
    edicao: data.edicao ?? null,
    fornecedor_id: data.fornecedor_id,
    fornecedor: data.fornecedores?.nome ?? "",
    importado_em: data.importado_em ?? null,
    sincronizado_em: data.sincronizado_em ?? null,
    ativo: Boolean(data.ativo),
  };
}

export async function lerSecoes(catalogoId: string): Promise<SecaoDoCatalogo[]> {
  const linhas = await lerTudo<Record<string, unknown>>((de, ate) =>
    (supabase as any)
      .from("fornecedor_secoes")
      .select(COLUNAS_DA_SECAO, { count: "exact" })
      .eq("catalogo_id", catalogoId)
      .order("ordem", { ascending: true })
      .order("id", { ascending: true })
      .range(de, ate),
  );
  return linhas.map((s) => ({
    id: String(s.id),
    ordem: Number(s.ordem ?? 0),
    titulo: String(s.titulo ?? ""),
    especificacao: (s.especificacao as string | null) ?? null,
  }));
}

export async function lerItens(catalogoId: string): Promise<ItemDoCatalogo[]> {
  const linhas = await lerTudo<Record<string, unknown>>((de, ate) =>
    (supabase as any)
      .from("fornecedor_itens")
      .select(`${COLUNAS_DO_ITEM}, fornecedor_item_modalidades(${COLUNAS_DA_MODALIDADE})`, { count: "exact" })
      .eq("catalogo_id", catalogoId)
      .order("ordem", { ascending: true })
      .order("id", { ascending: true })
      .range(de, ate),
  );
  return linhas.map(itemDaLinha);
}

export async function lerFotos(catalogoId: string): Promise<FotoDoAcervo[]> {
  const linhas = await lerTudo<Record<string, unknown>>((de, ate) =>
    (supabase as any)
      .from("fornecedor_fotos")
      .select(COLUNAS_DA_FOTO, { count: "exact" })
      .eq("catalogo_id", catalogoId)
      .order("caminho", { ascending: true })
      .range(de, ate),
  );
  return linhas.map((f) => ({
    id: String(f.id),
    codigo_fornecedor: (f.codigo_fornecedor as string | null) ?? null,
    legenda: (f.legenda as string | null) ?? null,
    origem: f.origem === "storage" ? "storage" : "repositorio",
    caminho: String(f.caminho),
  }));
}

/** Preço de venda por item e opção, no nível de quem pede (custo só para o financeiro). */
export async function lerPrecos(catalogoId: string): Promise<PrecosDoCatalogo> {
  const { data, error } = await (supabase.rpc as any)("catalogo_precos", { p_catalogo_id: catalogoId });
  if (error) throw error;
  if (!data || typeof data !== "object" || typeof data.precos !== "object") {
    throw new Error("O banco não devolveu os preços do catálogo.");
  }
  const precos: PrecosDoCatalogo["precos"] = {};
  for (const [itemId, lista] of Object.entries(data.precos as Record<string, any[]>)) {
    precos[itemId] = (Array.isArray(lista) ? lista : []).map((p) => ({
      modalidade: p.modalidade,
      preco: numeroOuNulo(p.preco),
      motivo: p.motivo ?? null,
      regra: p.regra ?? null,
      ...("custo" in p
        ? {
            custo: numeroOuNulo(p.custo),
            adicional_por_cor: numeroOuNulo(p.adicional_por_cor),
            margem_pct: numeroOuNulo(p.margem_pct),
            frete_por_peca: numeroOuNulo(p.frete_por_peca),
            preco_fixo: numeroOuNulo(p.preco_fixo),
          }
        : {}),
    }));
  }
  return { nivel: data.nivel === "financeiro" ? "financeiro" : "comercial", precos };
}

/** A regra gravada, no formato que a tela edita (só quem vê o financeiro lê). */
export async function lerRegras(catalogoId: string): Promise<RegrasDeVenda> {
  const { data, error } = await (supabase as any)
    .from("fornecedor_regras_venda")
    .select("secao_id, item_id, margem_pct, frete_por_peca, arredondamento, precos_fixos")
    .eq("catalogo_id", catalogoId);
  if (error) throw error;
  const regras: RegrasDeVenda = { catalogo: {}, secoes: {}, itens: {} };
  const limpar = <T extends Record<string, unknown>>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as T;
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const margem_pct = numeroOuNulo(r.margem_pct) ?? undefined;
    const frete_por_peca = numeroOuNulo(r.frete_por_peca) ?? undefined;
    if (r.item_id) {
      const fixos =
        r.precos_fixos && typeof r.precos_fixos === "object"
          ? (Object.fromEntries(
              Object.entries(r.precos_fixos as Record<string, unknown>)
                .map(([m, v]) => [m, numeroOuNulo(v)])
                .filter(([, v]) => v != null),
            ) as Partial<Record<Modalidade, number>>)
          : undefined;
      regras.itens[String(r.item_id)] = limpar({ margem_pct, frete_por_peca, precos_fixos: fixos });
    } else if (r.secao_id) {
      regras.secoes[String(r.secao_id)] = limpar({ margem_pct, frete_por_peca });
    } else {
      regras.catalogo = limpar({
        margem_pct,
        frete_por_peca,
        arredondamento: numeroOuNulo(r.arredondamento) ?? undefined,
      });
    }
  }
  return regras;
}

export type PreviaDasRegras = {
  modalidades: number;
  com_preco_antes: number;
  com_preco_depois: number;
  itens_com_preco_antes: number;
  itens_com_preco_depois: number;
  mudam: number;
  itens_que_mudam: number;
  sobem: number;
  descem: number;
  passam_a_ter_preco: number;
  ficam_sob_consulta: number;
  exemplos: {
    item_id: string;
    codigo_bex: string;
    nome: string;
    modalidade: Modalidade;
    unidade_preco: string;
    custo: number | null;
    antes: number | null;
    depois: number | null;
  }[];
};

export async function previaDasRegras(catalogoId: string, regras: RegrasDeVenda): Promise<PreviaDasRegras> {
  const { data, error } = await (supabase.rpc as any)("catalogo_previa_regras", {
    p_catalogo_id: catalogoId,
    p_regras: regras,
  });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("O banco não devolveu a prévia.");
  return data as PreviaDasRegras;
}

export async function salvarRegras(
  catalogoId: string,
  regras: RegrasDeVenda,
): Promise<{ itens_com_preco: number; excecoes_de_secao: number; excecoes_de_item: number }> {
  const { data, error } = await (supabase.rpc as any)("catalogo_salvar_regras", {
    p_catalogo_id: catalogoId,
    p_regras: regras,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error("O banco não confirmou a gravação da regra.");
  return data;
}

export type ResultadoDaImportacao = {
  importacao_id: string;
  novos: number;
  subiram: number;
  desceram: number;
  outras_mudancas: number;
  sairam: number;
  voltaram: number;
  iguais: number;
};

export async function importarPlanilha(catalogoId: string, plano: unknown): Promise<ResultadoDaImportacao> {
  const { data, error } = await (supabase.rpc as any)("catalogo_importar", {
    p_catalogo_id: catalogoId,
    p_plano: plano,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error("O banco não confirmou a sincronização.");
  return data;
}

export type ImportacaoFeita = {
  id: string;
  tipo: string;
  edicao: string | null;
  arquivo: string | null;
  novos: number;
  subiram: number;
  desceram: number;
  outras_mudancas: number;
  sairam: number;
  voltaram: number;
  iguais: number;
  feito_em: string;
};

export async function lerImportacoes(catalogoId: string): Promise<ImportacaoFeita[]> {
  const { data, error } = await (supabase as any)
    .from("fornecedor_importacoes")
    .select("id, tipo, edicao, arquivo, novos, subiram, desceram, outras_mudancas, sairam, voltaram, iguais, feito_em")
    .eq("catalogo_id", catalogoId)
    .order("feito_em", { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []) as ImportacaoFeita[];
}

export async function registrarFotos(
  catalogoId: string,
  fotos: { caminho: string; codigo_fornecedor: string }[],
  substituir: boolean,
): Promise<{ fotos: number; itens_apontados: number; codigos_sem_item: string[] }> {
  const { data, error } = await (supabase.rpc as any)("catalogo_registrar_fotos", {
    p_catalogo_id: catalogoId,
    p_fotos: fotos,
    p_substituir: substituir,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error("O banco não confirmou o registro das fotos.");
  return {
    fotos: Number(data.fotos ?? 0),
    itens_apontados: Number(data.itens_apontados ?? 0),
    codigos_sem_item: Array.isArray(data.codigos_sem_item) ? data.codigos_sem_item : [],
  };
}

export async function apontarFoto(itemId: string, fotoId: string | null): Promise<void> {
  const { data, error } = await (supabase.rpc as any)("catalogo_apontar_foto", {
    p_item_id: itemId,
    p_foto_id: fotoId,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error("O banco não confirmou a troca da foto.");
}

export async function resolverDuvida(itemId: string, unidade: string | null, nota: string): Promise<void> {
  const { data, error } = await (supabase.rpc as any)("catalogo_resolver_duvida", {
    p_item_id: itemId,
    p_unidade_preco: unidade,
    p_nota: nota,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error("O banco não confirmou a resolução da dúvida.");
}

export type ItemNoOrcamento = {
  orcamento_id: string;
  orcamento_numero: number | null;
  orcamento_novo: boolean;
  valor_unitario: number;
  valor_total: number | null;
  avisos: string[];
};

export async function adicionarAoOrcamento(dados: {
  itemId: string;
  modalidade: Modalidade;
  quantidade: number;
  orcamentoId: string | null;
  clienteId: string | null;
  titulo: string | null;
}): Promise<ItemNoOrcamento> {
  const { data, error } = await (supabase.rpc as any)("catalogo_adicionar_ao_orcamento", {
    p_item_id: dados.itemId,
    p_modalidade: dados.modalidade,
    p_quantidade: dados.quantidade,
    p_orcamento_id: dados.orcamentoId,
    p_cliente_id: dados.clienteId,
    p_titulo: dados.titulo,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error("O banco não confirmou o item no orçamento.");
  return {
    orcamento_id: String(data.orcamento_id),
    orcamento_numero: numeroOuNulo(data.orcamento_numero),
    orcamento_novo: Boolean(data.orcamento_novo),
    valor_unitario: Number(data.valor_unitario ?? 0),
    valor_total: numeroOuNulo(data.valor_total),
    avisos: Array.isArray(data.avisos) ? data.avisos : [],
  };
}

export async function gerarLink(dados: {
  catalogoId: string;
  itens: string[];
  titulo: string;
  clienteId: string | null;
  dias: number;
}): Promise<{ link_id: string; token: string; expira_em: string; itens: number; ignorados: number }> {
  const { data, error } = await (supabase.rpc as any)("catalogo_gerar_link", {
    p_catalogo_id: dados.catalogoId,
    p_itens: dados.itens,
    p_titulo: dados.titulo,
    p_cliente_id: dados.clienteId,
    p_dias: dados.dias,
  });
  if (error) throw error;
  if (!data?.token || !data?.link_id) throw new Error("O banco não devolveu o link.");
  return data;
}

export async function lerLinks(catalogoId: string): Promise<{ agora: string; links: LinkDaVitrine[] }> {
  const { data, error } = await (supabase.rpc as any)("catalogo_links", { p_catalogo_id: catalogoId });
  if (error) throw error;
  if (!data || !Array.isArray(data.links)) throw new Error("O banco não devolveu os links.");
  return { agora: String(data.agora), links: data.links as LinkDaVitrine[] };
}

export async function revogarLink(linkId: string): Promise<void> {
  const { data, error } = await (supabase.rpc as any)("catalogo_revogar_link", { p_link_id: linkId });
  if (error) throw error;
  if (!data?.ok) throw new Error("O banco não confirmou o cancelamento.");
}

export type ResumoDosCatalogos = {
  ve_preco: boolean;
  fornecedores: {
    id: string;
    nome: string;
    site: string | null;
    telefone: string | null;
    ativo: boolean;
    catalogos: {
      id: string;
      titulo: string;
      edicao: string | null;
      ativo: boolean;
      importado_em: string | null;
      sincronizado_em: string | null;
      itens: number;
      na_tabela: number;
      fora_da_tabela: number;
      com_foto: number;
      sem_foto: number;
      foto_a_apontar: number;
      em_duvida: number;
      sem_preco_de_venda: number | null;
    }[];
  }[];
};

export async function lerResumo(): Promise<ResumoDosCatalogos> {
  const { data, error } = await (supabase.rpc as any)("catalogo_resumo");
  if (error) throw error;
  if (!data || !Array.isArray(data.fornecedores)) throw new Error("O banco não devolveu os catálogos.");
  return data as ResumoDosCatalogos;
}

export type OrcamentoEmRascunho = {
  id: string;
  numero: number | null;
  titulo: string | null;
  cliente_nome: string | null;
  valor_total: number | null;
};

/** Orçamentos em rascunho — o único estado em que item novo entra (o banco confere de novo). */
export async function lerRascunhos(view: string): Promise<OrcamentoEmRascunho[]> {
  const { data, error } = await (supabase as any)
    .from(view)
    .select("id, numero, titulo, cliente_nome, valor_total")
    .eq("status", "rascunho")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((o) => ({
    id: String(o.id),
    numero: numeroOuNulo(o.numero),
    titulo: (o.titulo as string | null) ?? null,
    cliente_nome: (o.cliente_nome as string | null) ?? null,
    valor_total: numeroOuNulo(o.valor_total),
  }));
}

export type ClienteParaEscolher = { id: string; nome: string; telefone: string | null };

export async function lerClientes(): Promise<ClienteParaEscolher[]> {
  const linhas = await lerTudo<Record<string, unknown>>((de, ate) =>
    (supabase as any)
      .from("clientes")
      .select("id, nome, whatsapp_principal, telefone", { count: "exact" })
      .order("nome", { ascending: true })
      .order("id", { ascending: true })
      .range(de, ate),
  );
  return linhas.map((c) => ({
    id: String(c.id),
    nome: String(c.nome ?? ""),
    telefone: ((c.whatsapp_principal as string | null) || (c.telefone as string | null)) ?? null,
  }));
}

/** Cadastro de fornecedor e de catálogo (catalogo.manage): só as colunas com GRANT. */
export async function criarFornecedor(nome: string, site: string | null, telefone: string | null): Promise<string> {
  const { data, error } = await (supabase as any)
    .from("fornecedores")
    .insert({ nome: nome.trim(), site, telefone })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

export async function criarCatalogo(fornecedorId: string, titulo: string, edicao: string | null): Promise<string> {
  const { data, error } = await (supabase as any)
    .from("fornecedor_catalogos")
    .insert({ fornecedor_id: fornecedorId, titulo: titulo.trim(), edicao })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}
