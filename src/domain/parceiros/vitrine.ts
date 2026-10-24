import { categoriaLabel } from "@/lib/produtos-catalogo";
import type { ItemDoCatalogo } from "@/domain/parceiros/preco";

/**
 * Contas da vitrine da tabela do parceiro (foto, tipo, quanto ele economiza,
 * ordem). Sem rede e sem React, para os números poderem ser conferidos em teste.
 */

export type ExtrasDoProduto = { produto_id: string; imagem_url: string | null; tipo: string | null; descricao: string | null };

export type ItemDaVitrine = ItemDoCatalogo & { imagem_url: string | null; tipo: "produto" | "servico"; descricao: string | null };

export type OrdemDaVitrine = "nome" | "menor_preco" | "maior_economia";

export function juntarExtras(itens: ItemDoCatalogo[], extras: ExtrasDoProduto[]): ItemDaVitrine[] {
  const porId = new Map(extras.map((e) => [e.produto_id, e]));
  return itens.map((i) => {
    const e = porId.get(i.produto_id);
    return {
      ...i,
      imagem_url: e?.imagem_url ?? null,
      tipo: e?.tipo === "servico" ? "servico" : "produto",
      descricao: e?.descricao ?? null,
    };
  });
}

export const tipoLegivel = (t: "produto" | "servico") => (t === "servico" ? "Serviço" : "Produto");

export const categoriaLegivel = (c: string | null | undefined) => categoriaLabel(c || "outros");

/** O menor preço que o parceiro paga neste produto (a faixa mais barata, quando há faixas). */
export function precoAPartirDe(p: ItemDoCatalogo): number | null {
  if (p.faixas?.length) return Math.min(...p.faixas.map((f) => Number(f.preco_parceiro)));
  return p.preco_parceiro == null ? null : Number(p.preco_parceiro);
}

/** Quanto o parceiro paga abaixo do balcão, em %, no preço de entrada (1ª faixa ou preço único). */
export function economiaEmPct(p: ItemDoCatalogo): number | null {
  const faixa = p.faixas?.length ? [...p.faixas].sort((a, b) => a.quantidade_minima - b.quantidade_minima)[0] : null;
  const ref = faixa ? Number(faixa.preco_referencia) : p.preco_referencia == null ? null : Number(p.preco_referencia);
  const par = faixa ? Number(faixa.preco_parceiro) : p.preco_parceiro == null ? null : Number(p.preco_parceiro);
  if (ref == null || par == null || ref <= 0 || par >= ref) return null;
  return Math.round(((ref - par) / ref) * 100);
}

export function ordenar<T extends ItemDoCatalogo>(itens: T[], ordem: OrdemDaVitrine): T[] {
  const copia = [...itens];
  const porNome = (a: T, b: T) => a.nome.localeCompare(b.nome, "pt-BR");
  if (ordem === "menor_preco") {
    return copia.sort((a, b) => (precoAPartirDe(a) ?? Infinity) - (precoAPartirDe(b) ?? Infinity) || porNome(a, b));
  }
  if (ordem === "maior_economia") {
    return copia.sort((a, b) => (economiaEmPct(b) ?? -1) - (economiaEmPct(a) ?? -1) || porNome(a, b));
  }
  return copia.sort(porNome);
}
