import type { NivelDeVisao } from "@/lib/supabase-financial-views";

/**
 * As colunas que o seletor de produto lê, por nível de visão (10/11/2026).
 *
 * Os dois seletores (a escolha em cartões do orçamento e o catálogo da OS) faziam `select("*")` na view do
 * nível de quem olha. A view traz `observacoes_internas`, e a nota interna do produto chegava ao navegador
 * do vendedor e do operador sem nenhuma tela usar. Em 05/11/2026 a nota de 10 produtos tinha custo em reais
 * (a mesma limpeza que tirou o valor do texto), e nada impedia de digitar de novo. Pedir só o que a tela usa
 * fecha o canal, mesmo que alguém escreva valor numa nota no futuro.
 *
 * As VIEWS não perdem a coluna: a edição rápida e a pasta do produto leem a nota por elas e gravariam vazio
 * ao salvar. Quem fecha o canal é a lista de colunas da consulta.
 *
 * Cada coluna daqui existe em cada view do nível e é legível por `authenticated` (conferido no banco em
 * 10/11/2026, `has_column_privilege`). Coluna que a view não tem derruba a consulta inteira e o catálogo
 * "abre vazio": por isso a lista cresce por nível (preço só a partir do comercial, custo só no financeiro)
 * e o teste `tests/custo-fora-do-texto-livre-tela.test.ts` confere cada nível contra o que a view tem.
 *
 * O que sai daqui é o contrato de `ProdutoDaEscolha` (escolha-de-produto.tsx) mais o que o catálogo da OS
 * usa (`sku`, `descricao`, `categoria`, `custo_medio`).
 */
const DE_TODOS = [
  "id",
  "nome",
  "sku",
  "descricao",
  "categoria",
  "tipo",
  "unidade",
  "imagem_url",
  "area_minima_cobrada",
  "tempo_producao_min",
  "familia",
] as const;

/** Preço de venda: existe no comercial e no financeiro. */
const DE_VENDA = ["preco_base", "preco_parceiro"] as const;

/** Custo e margem: só o financeiro. */
const DE_CUSTO = ["custo_medio", "margem_minima"] as const;

export function colunasDoSeletorDeProdutos(nivel: NivelDeVisao): string {
  const colunas: string[] = [...DE_TODOS];
  if (nivel !== "operacional") colunas.push(...DE_VENDA);
  if (nivel === "financeiro") colunas.push(...DE_CUSTO);
  return colunas.join(", ");
}
