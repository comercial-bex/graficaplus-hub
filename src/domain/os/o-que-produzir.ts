/**
 * O que a OS manda produzir, em uma linha.
 *
 * O cartão do quadro mostrava "Produto não definido" e "Máquina não definida" —
 * duas frases sobre o que NÃO se sabe — enquanto os itens da OS, que dizem
 * exatamente o que vai ser feito e em que medida, não apareciam em lugar
 * nenhum. Conferido no banco em 09/09/2026: a OS #44 tem item cadastrado
 * ("Urna e Gatinho Anjo", 1 un) e `produto_id` nulo. O cartão preferia falar do
 * campo vazio a falar do preenchido.
 *
 * A regra aqui é: dizer o que se sabe. Medida quando existe, quantidade quando
 * existe, e silêncio no lugar de "não definido".
 */

export type ItemOs = {
  descricao?: string | null;
  quantidade?: number | string | null;
  unidade?: string | null;
  largura?: number | string | null;
  altura?: number | string | null;
  area_total?: number | string | null;
  acabamento?: string | null;
};

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "3,00 × 0,70 m" — a medida como a gráfica fala. */
export function medidaEmTexto(item: ItemOs): string | null {
  const l = num(item.largura);
  const a = num(item.altura);
  if (!l || !a) return null;
  const fmt = (n: number) => n.toFixed(2).replace(".", ",");
  return `${fmt(l)} × ${fmt(a)} m`;
}

/**
 * A quantidade só entra quando é mais de uma. "1 un" é ruído: toda OS tem pelo
 * menos uma peça, e a linha do cartão é curta.
 */
export function quantidadeEmTexto(item: ItemOs): string | null {
  const q = num(item.quantidade);
  if (q == null || q <= 1) return null;
  const inteiro = Number.isInteger(q) ? String(q) : q.toFixed(2).replace(".", ",");
  return `${inteiro} ${item.unidade || "un"}`;
}

/** Uma linha por item: descrição, medida e quantidade, sem repetir o vazio. */
export function descreverItem(item: ItemOs): string {
  const partes = [item.descricao?.trim(), medidaEmTexto(item), quantidadeEmTexto(item)].filter(
    (p): p is string => Boolean(p),
  );
  return partes.join(" · ") || "Item sem descrição";
}

export type ResumoProducao = {
  /** A linha que cabe no cartão. */
  linha: string;
  /** Quantos itens além do primeiro — vira "+2" no cartão. */
  extras: number;
  /** Metragem somada, quando os itens têm área. Null quando nenhum tem. */
  areaTotal: number | null;
};

/**
 * O resumo do cartão. Fala do primeiro item e conta o resto — porque o cartão
 * responde "o que é isso" num relance, e a lista inteira é assunto da ficha.
 */
export function resumoDaProducao(itens: ItemOs[] | null | undefined): ResumoProducao | null {
  const lista = itens ?? [];
  if (lista.length === 0) return null;

  const areas = lista.map((i) => num(i.area_total)).filter((a): a is number => a != null && a > 0);

  return {
    linha: descreverItem(lista[0]),
    extras: lista.length - 1,
    areaTotal: areas.length > 0 ? areas.reduce((s, a) => s + a, 0) : null,
  };
}

/** "12,50 m²" — metragem do jeito que aparece no orçamento. */
export function areaEmTexto(area: number | null): string | null {
  if (area == null || area <= 0) return null;
  return `${area.toFixed(2).replace(".", ",")} m²`;
}
