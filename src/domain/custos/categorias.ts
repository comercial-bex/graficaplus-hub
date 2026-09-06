/**
 * Categorias de custo operacional da OS — a lista que o banco realmente aceita.
 *
 * Existe porque errei exatamente isso: escrevi `mao_de_obra` (com o "de") numa
 * função de relatório, e a categoria real é `mao_obra`. O filtro não casava com
 * nada e a mão de obra saía SEMPRE ZERO — numa tela de custo de gráfica, onde
 * mão de obra costuma ser o maior custo. Não deu erro em lugar nenhum: a coluna
 * simplesmente somava zero, com cara de número.
 *
 * É o pior tipo de defeito deste sistema: nome quase certo, resultado plausível,
 * silêncio total. A lista fica aqui para que o teste possa conferir as migrações
 * contra ela.
 *
 * Espelha `custos_operacionais_os_categoria_check`. Ao mudar a trava no banco,
 * mude aqui — o teste falha se as duas se separarem.
 */
export const CATEGORIAS_CUSTO_OS = [
  "material",
  "mao_obra",
  "maquina",
  "terceiros",
  "acabamento",
  "logistica",
  "retrabalho",
  "taxa",
  "comissao",
  "perda",
] as const;

export type CategoriaCustoOS = (typeof CATEGORIAS_CUSTO_OS)[number];

/** Rótulos para tela. Categoria sem rótulo aparece como veio, não some. */
export const rotuloCategoriaCusto: Record<CategoriaCustoOS, string> = {
  material: "Material",
  mao_obra: "Mão de obra",
  maquina: "Hora de máquina",
  terceiros: "Terceiros",
  acabamento: "Acabamento",
  logistica: "Logística",
  retrabalho: "Retrabalho",
  taxa: "Taxas",
  comissao: "Comissão",
  perda: "Perda / desperdício",
};

export function ehCategoriaCusto(valor: string): valor is CategoriaCustoOS {
  return (CATEGORIAS_CUSTO_OS as readonly string[]).includes(valor);
}
