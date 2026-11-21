import type { Permission } from "@/lib/permissions";
import {
  areaCobrada,
  custoDaPecaPorArea,
  ehUnidadeDeArea,
  temDimensoes,
  valorDaLinhaPorM2,
  valorUnitarioComMinimo,
} from "@/domain/orcamentos/area";

/**
 * Quem inclui e apaga item da OS: as mesmas chaves da regra "itens_os
 * permission all" do banco (kanban.move ou orcamentos.create — admin, gestor e
 * vendedor). Os outros veem a lista; a regra recusaria a gravação de qualquer
 * jeito (migração 20261008043700).
 */
export const CHAVES_QUE_EDITAM_ITENS: readonly Permission[] = ["kanban.move", "orcamentos.create"];

export function podeEditarItensDaOS(temPermissao: (p: Permission) => boolean): boolean {
  return CHAVES_QUE_EDITAM_ITENS.some((p) => temPermissao(p));
}

/**
 * O ITEM QUE SE INCLUI NA ABA "ITENS DA OS" (21/11/2026).
 *
 * A aba copiava o preço e o custo do produto direto na linha: `valor_unitario = preco_base` e
 * `custo_unitario = custo_medio`. Para produto vendido por metro quadrado (acrílico, adesivo, lona, banner)
 * os dois são valores POR m², não por peça, e a aba não pedia largura nem altura: uma peça de acrílico de 2 mm
 * de 0,30 × 0,20 m entrava por R$ 1.000,00 (o m² inteiro) em vez de R$ 100,00 (o mínimo de 0,10 m²), com custo
 * de R$ 151,13 em vez de R$ 15,11. O total da OS é a soma dos itens (`tg_os_soma_os_itens`), então o erro ia
 * para o total, para a cobrança e para a margem. O orçamento já tinha corrigido isto em 20/10/2026
 * (`custoDaPecaPorArea`); a OS ficou com a conta antiga.
 *
 * Agora o item vendido por área leva largura, altura, quantidade de peças e o preço por m², e a conta é a do
 * orçamento (`src/domain/orcamentos/area.ts`, a mesma do gatilho `tg_item_os_precificar_por_area`): área exata da
 * peça com o mínimo cobrado, total da linha arredondado uma vez, em centavos.
 */
export type EntradaDoItemDaOS = {
  descricao: string;
  /** peças (item por área) ou unidades (item comum) */
  quantidade: number;
  unidade: string;
  produtoId: string | null;
  /** item comum: preço e custo DE UMA unidade */
  valorUnitario: number;
  custoUnitario: number;
  /** item por área: preço e custo POR m², e a medida da peça em metros */
  precoM2?: number;
  custoM2?: number;
  largura?: number;
  altura?: number;
  areaMinima?: number | null;
  /** quem não vê preço grava 0 (o comercial vê preço; o operacional não) */
  podeVerPreco: boolean;
  /** quem não vê custo deixa o custo para o banco preencher */
  podeVerCusto: boolean;
};

/** O que vai para `itens_os` (sem `os_id` e `ordem`, que a tela põe). Colunas de área são geradas pelo banco. */
export type LinhaDoItemDaOS = {
  descricao: string;
  quantidade: number;
  unidade: string;
  produto_id: string | null;
  valor_unitario: number;
  custo_unitario: number;
  valor_total: number;
  preco_m2?: number;
  largura?: number;
  altura?: number;
  area_minima?: number | null;
};

export type ResumoDoItemPorArea = {
  /** m² que entram na conta, já com o mínimo por peça, vezes as peças */
  areaCobrada: number;
  /** o mínimo por peça passou da área real da peça */
  pagaMinimo: boolean;
  totalDaLinha: number;
  valorDaPeca: number;
  custoDaPeca: number;
};

export type ItemDaOSMontado =
  | { ok: true; linha: LinhaDoItemDaOS; porArea: ResumoDoItemPorArea | null }
  | { ok: false; erro: string };

const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const finito = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** O item é vendido por metro quadrado? Produto do catálogo com unidade m2 / m². */
export function vendidoPorAreaNaOS(unidade: string | null | undefined, produtoId: string | null): boolean {
  return produtoId !== null && ehUnidadeDeArea(unidade);
}

/** A conta do item por área, para a tela mostrar antes de gravar. null sem medida. */
export function resumoDoItemPorArea(e: {
  quantidade: number;
  precoM2: number;
  custoM2: number;
  largura: number;
  altura: number;
  areaMinima?: number | null;
}): ResumoDoItemPorArea | null {
  const peca = { largura: finito(e.largura), altura: finito(e.altura), quantidade: finito(e.quantidade) };
  if (!temDimensoes(peca)) return null;
  const minimo = e.areaMinima ?? null;
  const exata = peca.largura * peca.altura;
  return {
    areaCobrada: areaCobrada(peca, minimo),
    pagaMinimo: finito(minimo ?? 0) > exata,
    totalDaLinha: valorDaLinhaPorM2(peca, finito(e.precoM2), minimo),
    valorDaPeca: valorUnitarioComMinimo(peca, finito(e.precoM2), minimo),
    custoDaPeca: custoDaPecaPorArea(peca, finito(e.custoM2), minimo),
  };
}

/**
 * Monta a linha de `itens_os` para gravar. Item por área sem largura e altura é recusado: gravar o preço por
 * m² como preço da peça foi o erro que esta função existe para impedir.
 */
export function montarItemDaOS(e: EntradaDoItemDaOS): ItemDaOSMontado {
  const quantidade = finito(e.quantidade);
  if (!(quantidade > 0)) return { ok: false, erro: "Informe a quantidade (maior que zero)." };

  if (vendidoPorAreaNaOS(e.unidade, e.produtoId)) {
    const resumo = resumoDoItemPorArea({
      quantidade,
      precoM2: e.podeVerPreco ? finito(e.precoM2) : 0,
      custoM2: e.podeVerCusto ? finito(e.custoM2) : 0,
      largura: finito(e.largura),
      altura: finito(e.altura),
      areaMinima: e.areaMinima,
    });
    if (!resumo) {
      return {
        ok: false,
        erro: "Este produto é vendido por m²: informe a largura e a altura da peça, em metros.",
      };
    }
    if (e.podeVerPreco && !(finito(e.precoM2) > 0)) {
      return { ok: false, erro: "Informe o preço por m² (maior que zero)." };
    }
    const linha: LinhaDoItemDaOS = {
      descricao: e.descricao,
      quantidade,
      unidade: e.unidade,
      produto_id: e.produtoId,
      valor_unitario: e.podeVerPreco ? resumo.valorDaPeca : 0,
      valor_total: e.podeVerPreco ? resumo.totalDaLinha : 0,
      // sem custo na mão, 0: o banco preenche pelo custo do produto (migração 20261121130000)
      custo_unitario: e.podeVerCusto ? resumo.custoDaPeca : 0,
      largura: finito(e.largura),
      altura: finito(e.altura),
      area_minima: e.areaMinima ?? null,
      ...(e.podeVerPreco ? { preco_m2: finito(e.precoM2) } : {}),
    };
    return { ok: true, linha, porArea: resumo };
  }

  const valorUnitario = e.podeVerPreco ? finito(e.valorUnitario) : 0;
  return {
    ok: true,
    porArea: null,
    linha: {
      descricao: e.descricao,
      quantidade,
      unidade: e.unidade,
      produto_id: e.produtoId,
      valor_unitario: valorUnitario,
      custo_unitario: finito(e.custoUnitario),
      valor_total: centavos(quantidade * valorUnitario),
    },
  };
}
