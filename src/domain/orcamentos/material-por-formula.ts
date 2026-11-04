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
  /** Por peça, com oito casas: ilhós são inteiros, metros de fita não, e litro de verniz numa etiqueta é fração de mL. */
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

/**
 * A quantidade por peça guarda 8 casas, só para tirar o ruído do ponto flutuante. Com 4 casas (até 04/11/2026)
 * "area * 0,01" (10 mL por m², escrito em litros) numa etiqueta de 5 × 5 cm dava 0,000025 e gravava ZERO, sem
 * erro: o item saía sem o custo do verniz, com 1 peça ou com 10.000. O banco multiplica por quantidade e custo
 * em numeric exato, então não há razão para a tela perder fração antes.
 */
const oitoCasas = (n: number) => Math.round((n + Number.EPSILON) * 1e8) / 1e8;

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
    // Zero DEPOIS de arredondar também é erro à vista: quantidade zero gravada como se fosse válida some do custo.
    const quantidade = oitoCasas(r.valor);
    if (!(r.valor > 0) || !(quantidade > 0)) {
      linhas.push({ formula_id: f.id, material_id: f.material_id, nome, unidade, script: f.script, quantidade: 0, erro: "A conta deu zero ou menos: nada entra." });
      continue;
    }
    linhas.push({ formula_id: f.id, material_id: f.material_id, nome, unidade, script: f.script, quantidade, erro: null });
  }
  // O mesmo material em duas fórmulas soma: o banco recebe uma linha por material.
  const porMaterial = new Map<string, number>();
  for (const l of linhas) if (!l.erro) porMaterial.set(l.material_id, oitoCasas((porMaterial.get(l.material_id) ?? 0) + l.quantidade));
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

/**
 * O custo das fórmulas por peça, para quem vê custo: quantidade × custo de compra do material.
 *
 * SEM arredondar a centavos (revisão de 04/11/2026): o gatilho do banco guarda `custo_formulas`
 * sem escala e o custo do item é esse número × quantidade. 0,015 m de fita a R$ 0,30 são R$ 0,0045
 * por peça, R$ 135,00 em 30.000 peças; arredondado a centavos virava zero e a tela mostrava
 * "Custo por peça: R$ 0,00" e uma margem maior que a gravada. O arredondamento em 8 casas só
 * tira o ruído do ponto flutuante (12 × 0,35 dá 4,199999999999999).
 */
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
  return { total: Math.round((total + Number.EPSILON) * 1e8) / 1e8, semCusto };
}

/** Como está a leitura das fórmulas do produto no formulário do item. */
export type LeituraDasFormulas = "pendente" | "erro" | "ok";

/**
 * O que o Salvar do item faz com o material por fórmula (revisão de 04/11/2026).
 *
 * `materiais_por_formula` vai por cima do que o item tinha, e o gatilho do banco zera a parte das
 * fórmulas do custo quando a lista vem vazia. Enquanto a consulta das fórmulas do produto ainda
 * não voltou, ou se ela falhou, a lista de fórmulas "válidas" é vazia por ausência de dado e não por
 * escolha: gravar assim apagaria o custo que o item já tinha, sem aviso. Nesse caso o Salvar espera.
 * Item sem produto não tem fórmula nenhuma: grava lista vazia (trocar o produto por item livre limpa).
 */
export function formulasParaGravar(a: {
  produtoId: string | null | undefined;
  leitura: LeituraDasFormulas;
  validas: readonly MaterialPorFormula[];
}): { gravar: true; valor: MaterialPorFormula[] } | { gravar: false; pendencia: string } {
  if (!a.produtoId) return { gravar: true, valor: [] };
  if (a.leitura === "pendente") {
    return { gravar: false, pendencia: "Calculando o material por fórmula deste produto. Tente salvar de novo em instantes." };
  }
  if (a.leitura === "erro") {
    return {
      gravar: false,
      pendencia: "Não consegui ler as fórmulas deste produto. Salvar agora apagaria o custo delas no item: tente de novo.",
    };
  }
  return { gravar: true, valor: [...a.validas] };
}

/** "Ilhós metálico 8 un · Fita 2,5 m", para o resumo do item. */
export function resumoDasFormulas(linhas: readonly LinhaDeFormula[]): string {
  return linhas
    .filter((l) => !l.erro)
    .map((l) => `${l.nome} ${l.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} ${l.unidade}`)
    .join(" · ");
}
