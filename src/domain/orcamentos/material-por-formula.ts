import { avaliarFormula, type VariaveisDaFormula } from "@/domain/catalogo/pasta-do-produto";

/**
 * Material calculado por fórmula no item do orçamento (fase 4 do plano de
 * 02/11/2026). A aba Fórmulas da pasta diz "para este produto, o material X
 * entra na quantidade `teto(perimetro / 0,5)`"; aqui a fórmula roda com a
 * medida do item e vira uma lista de materiais com quantidade POR PEÇA, que o
 * item grava em `orcamento_itens.materiais_por_formula`. O custo em reais quem
 * calcula é o banco (gatilho), com o custo de compra do material: a tela de
 * quem não vê custo nunca precisa saber quanto o material custa.
 */

export type FormulaDoProduto = {
  id: string;
  material_id: string;
  script: string;
  descricao?: string | null;
  material?: { nome: string; unidade: string | null } | null;
};

export type MaterialPorFormula = {
  material_id: string;
  /** Por peça, com quatro casas: ilhós são inteiros, metros de fita não. */
  quantidade: number;
};

export type LinhaDeFormula = MaterialPorFormula & {
  formula_id: string;
  nome: string;
  unidade: string;
  script: string;
  /** Fórmula que não deu número: a linha aparece na tela e não entra na gravação. */
  erro: string | null;
};

const quatroCasas = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** As fórmulas do produto rodadas na medida do item: o que entra e o que falhou. */
export function materiaisPorFormula(
  formulas: readonly FormulaDoProduto[],
  medidas: VariaveisDaFormula,
): { linhas: LinhaDeFormula[]; validas: MaterialPorFormula[] } {
  const linhas: LinhaDeFormula[] = [];
  for (const f of formulas) {
    const r = avaliarFormula(f.script, medidas);
    const nome = f.material?.nome ?? "Material";
    const unidade = f.material?.unidade ?? "un";
    if (!r.ok) {
      linhas.push({ formula_id: f.id, material_id: f.material_id, nome, unidade, script: f.script, quantidade: 0, erro: r.erro });
      continue;
    }
    if (!(r.valor > 0)) {
      linhas.push({ formula_id: f.id, material_id: f.material_id, nome, unidade, script: f.script, quantidade: 0, erro: "A conta deu zero ou menos: nada entra." });
      continue;
    }
    linhas.push({ formula_id: f.id, material_id: f.material_id, nome, unidade, script: f.script, quantidade: quatroCasas(r.valor), erro: null });
  }
  // O mesmo material em duas fórmulas soma: o banco recebe uma linha por material.
  const porMaterial = new Map<string, number>();
  for (const l of linhas) if (!l.erro) porMaterial.set(l.material_id, quatroCasas((porMaterial.get(l.material_id) ?? 0) + l.quantidade));
  return { linhas, validas: [...porMaterial.entries()].map(([material_id, quantidade]) => ({ material_id, quantidade })) };
}

/** As medidas que a fórmula enxerga, a partir do item: peça por peça, com as cópias em 1. */
export function medidasDoItem(a: { largura: number | null | undefined; altura: number | null | undefined; quantidade: number | null | undefined }): VariaveisDaFormula {
  return {
    largura: Number(a.largura) > 0 ? Number(a.largura) : 0,
    altura: Number(a.altura) > 0 ? Number(a.altura) : 0,
    copias: 1,
    quantidade: Number(a.quantidade) > 0 ? Number(a.quantidade) : 1,
  };
}

/** O custo das fórmulas por peça, para quem vê custo: quantidade × custo de compra do material. */
export function custoDasFormulas(
  validas: readonly MaterialPorFormula[],
  custoDoMaterial: ReadonlyMap<string, number>,
): { total: number; semCusto: string[] } {
  let total = 0;
  const semCusto: string[] = [];
  for (const v of validas) {
    const c = custoDoMaterial.get(v.material_id);
    if (c === undefined || !(c > 0)) {
      semCusto.push(v.material_id);
      continue;
    }
    total += v.quantidade * c;
  }
  return { total: Math.round((total + Number.EPSILON) * 100) / 100, semCusto };
}

/** "Ilhós metálico 8 un · Fita 2,5 m", para o resumo do item. */
export function resumoDasFormulas(linhas: readonly LinhaDeFormula[]): string {
  return linhas
    .filter((l) => !l.erro)
    .map((l) => `${l.nome} ${l.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ${l.unidade}`)
    .join(" · ");
}
