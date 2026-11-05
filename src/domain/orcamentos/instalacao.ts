/**
 * Instalação ligada ao item que ela instala (decisão da equipe, 05/11/2026).
 *
 * O vínculo fica em `orcamento_itens.instala_item_id` (coluna própria, com
 * chave estrangeira para o mesmo orçamento e ON DELETE SET NULL). Domínio puro.
 */

export type ProdutoParaInstalacao = {
  id: string;
  tipo?: string | null;
  categoria?: string | null;
  unidade?: string | null;
};

export type ItemParaInstalacao = {
  id: string;
  descricao?: string | null;
  unidade?: string | null;
  produto_id?: string | null;
  instala_item_id?: string | null;
  gerado_por_item_id?: string | null;
  tipo_produto?: string | null;
};

const ehHora = (u: string | null | undefined) => {
  const x = String(u ?? "").trim().toLowerCase();
  return x === "h" || x === "hr" || x === "hora" || x === "horas";
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Com produto do catálogo, quem decide é o produto: serviço + categoria
 * `instalacao` + unidade hora. Deslocamento (km) não é instalação.
 * Item livre: descrição começando com "Instalação" e unidade hora.
 */
export function ehItemDeInstalacao(
  item: Pick<ItemParaInstalacao, "descricao" | "unidade" | "produto_id">,
  produtos: ProdutoParaInstalacao[],
): boolean {
  if (item.produto_id) {
    const p = produtos.find((x) => x.id === item.produto_id);
    if (!p) return false;
    return p.tipo === "servico" && p.categoria === "instalacao" && ehHora(p.unidade);
  }
  return semAcento(String(item.descricao ?? "").trim()).startsWith("instalacao") && ehHora(item.unidade);
}

/** Itens que uma instalação pode instalar: os de produto, sem serviços, cobranças geradas nem a taxa. */
export function itensQuePodemSerInstalados<T extends ItemParaInstalacao>(
  itens: T[],
  produtos: ProdutoParaInstalacao[],
  excetoId?: string | null,
): T[] {
  return itens.filter((i) => {
    if (i.id === excetoId) return false;
    if (i.tipo_produto === "taxa_prazo" || i.gerado_por_item_id) return false;
    if (ehItemDeInstalacao(i, produtos)) return false;
    if (i.produto_id) {
      const p = produtos.find((x) => x.id === i.produto_id);
      if (p?.tipo === "servico") return false;
    }
    return true;
  });
}

/** Descrições das instalações sem item de origem válido (vazio ou apontando para item que não existe mais). */
export function instalacoesSemOrigem(itens: ItemParaInstalacao[], produtos: ProdutoParaInstalacao[]): string[] {
  const ids = new Set(itens.map((i) => i.id));
  return itens
    .filter((i) => ehItemDeInstalacao(i, produtos))
    .filter((i) => !i.instala_item_id || i.instala_item_id === i.id || !ids.has(i.instala_item_id))
    .map((i) => String(i.descricao ?? "Instalação"));
}

/** A pendência só existe enquanto o orçamento pode ser editado: nunca em aprovado, convertido ou fechado. */
export function vinculoDaInstalacaoConta(status: string | null | undefined, fechado: boolean): boolean {
  return !fechado && (status === "rascunho" || status === "enviado");
}

/** "Adesivo perfurado (one way)" → "Instalação do adesivo perfurado (one way)". */
export function descricaoDaInstalacao(nomeDoItem: string): string {
  const nome = nomeDoItem.trim();
  if (!nome) return "Instalação";
  return `Instalação do ${nome.charAt(0).toLocaleLowerCase("pt-BR")}${nome.slice(1)}`;
}

/** Com um único item que pode ser instalado, ele já vem escolhido; com mais, nenhum. */
export function origemPadrao(candidatos: { id: string }[]): string | null {
  return candidatos.length === 1 ? candidatos[0].id : null;
}

/**
 * A descrição ao escolher o item de origem. Só troca o texto que ainda é
 * automático (vazio, o nome do produto de instalação ou uma descrição
 * "Instalação do …" gerada); o que o vendedor escreveu fica.
 */
export function descricaoAoEscolherOrigem(o: {
  atual: string;
  nomeDaOrigem: string;
  nomeDoProduto?: string | null;
  automaticas: string[];
}): string {
  const atual = o.atual.trim();
  const automatico =
    atual === "" ||
    (!!o.nomeDoProduto && atual === o.nomeDoProduto.trim()) ||
    o.automaticas.some((a) => a.trim() === atual);
  return automatico ? descricaoDaInstalacao(o.nomeDaOrigem) : o.atual;
}
