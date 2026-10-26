/**
 * Metragem por material do orçamento (27/10/2026).
 *
 * "Quando eu clico no orçamento, preciso ver a metragem de cada material." A tabela de
 * itens mostra a área de cada linha; aqui as linhas são somadas POR MATERIAL (lona 280g,
 * adesivo vinil…): é a conta que a produção faz para separar bobina e a que o vendedor
 * usa para responder "quanto de lona vai nesse pedido?".
 *
 * Regras:
 *   * A área que conta é a COBRADA (área mínima aplicada), que é a que sai do rolo; sem
 *     ela, a área total; sem medida, a linha conta por unidade.
 *   * O material é o principal do produto (cadastro); sem produto, o nome do item.
 *   * Peça 3D soma em gramas de filamento: (modelo + suporte + purga) × impressões.
 *
 * Domínio puro: nada de banco aqui.
 */

export type ItemParaMetragem = {
  id: string;
  descricao: string;
  quantidade: number | string | null;
  unidade?: string | null;
  area_total?: number | string | null;
  area_cobrada?: number | string | null;
  produto_id?: string | null;
  tipo_produto?: string | null;
  origem_calculo?: string | null;
};

export type ProdutoParaMetragem = {
  id: string;
  nome: string;
  material_principal_id?: string | null;
  material_nome?: string | null;
};

export type Peca3dParaMetragem = {
  item_id: string | null;
  material_descricao?: string | null;
  gramas_modelo?: number | string | null;
  peso_suporte_g?: number | string | null;
  peso_purga_g?: number | string | null;
  pecas_por_placa?: number | string | null;
  quantidade?: number | string | null;
};

export type LinhaDeMetragem = {
  material: string;
  /** m² somados (0 quando o material só conta por unidade) */
  m2: number;
  /** peças somadas */
  pecas: number;
  /** gramas de filamento (peça 3D) */
  gramas: number;
  itens: number;
};

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function metragemPorMaterial(
  itens: ItemParaMetragem[],
  produtos: ProdutoParaMetragem[],
  pecas3d: Peca3dParaMetragem[] = [],
): LinhaDeMetragem[] {
  const porProduto = new Map(produtos.map((p) => [p.id, p]));
  const por3d = new Map(pecas3d.filter((p) => p.item_id).map((p) => [p.item_id as string, p]));
  const linhas = new Map<string, LinhaDeMetragem>();

  const somar = (material: string, delta: Partial<LinhaDeMetragem>) => {
    const chave = material.trim() || "Sem material";
    const atual = linhas.get(chave) ?? { material: chave, m2: 0, pecas: 0, gramas: 0, itens: 0 };
    atual.m2 += delta.m2 ?? 0;
    atual.pecas += delta.pecas ?? 0;
    atual.gramas += delta.gramas ?? 0;
    atual.itens += delta.itens ?? 0;
    linhas.set(chave, atual);
  };

  for (const i of itens) {
    if (i.origem_calculo === "taxa_prazo" || i.tipo_produto === "taxa_prazo") continue;
    const peca = por3d.get(i.id);
    if (peca || i.origem_calculo === "orcamento_3d") {
      const qtd = Math.max(1, n(peca?.quantidade ?? i.quantidade) || 1);
      const porPlaca = Math.max(1, n(peca?.pecas_por_placa) || 1);
      const impressoes = Math.max(1, Math.ceil(qtd / porPlaca));
      const gramasPlaca = n(peca?.gramas_modelo) + n(peca?.peso_suporte_g) + n(peca?.peso_purga_g);
      somar(`${peca?.material_descricao?.trim() || "Filamento 3D"} (3D)`, {
        gramas: gramasPlaca * impressoes,
        pecas: qtd,
        itens: 1,
      });
      continue;
    }
    const produto = i.produto_id ? porProduto.get(i.produto_id) : undefined;
    const material = produto?.material_nome || produto?.nome || i.descricao;
    const area = n(i.area_cobrada) || n(i.area_total);
    somar(material, { m2: area, pecas: n(i.quantidade) || 1, itens: 1 });
  }

  return [...linhas.values()].sort((a, b) => b.m2 - a.m2 || b.gramas - a.gramas || a.material.localeCompare(b.material));
}

const fmt = (v: number, casas = 2) => v.toLocaleString("pt-BR", { maximumFractionDigits: casas });

/** "6,17 m² · 3 peças", "42 g · 2 peças" ou "3 un". */
export function descreverLinhaDeMetragem(l: LinhaDeMetragem): string {
  if (l.gramas > 0) return `${fmt(l.gramas, 0)} g · ${fmt(l.pecas, 0)} ${l.pecas === 1 ? "peça" : "peças"}`;
  if (l.m2 > 0) return `${fmt(l.m2)} m² · ${fmt(l.pecas, 0)} ${l.pecas === 1 ? "peça" : "peças"}`;
  return `${fmt(l.pecas, 0)} un`;
}

/** Totais do orçamento: m² somados e gramas somadas (para o rodapé). */
export function totaisDaMetragem(linhas: LinhaDeMetragem[]): { m2: number; gramas: number } {
  return linhas.reduce((acc, l) => ({ m2: acc.m2 + l.m2, gramas: acc.gramas + l.gramas }), { m2: 0, gramas: 0 });
}
