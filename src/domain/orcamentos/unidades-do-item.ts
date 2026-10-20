/**
 * As unidades em que um item de orçamento é vendido.
 *
 * Até 20/10/2026 o campo "Unidade" do item era texto livre. Nos dados reais só
 * existem duas ("un": 24 itens; "m2": 12), mas qualquer erro de digitação muda
 * o comportamento da tela: "m²" e "m2" a tela entende, "metro quadrado" e "M 2"
 * viravam "un" em silêncio e a tela deixava de pedir a medida. Agora é uma lista;
 * o valor guardado segue o mesmo de sempre ("un", "m2", "mil", …), e uma unidade
 * antiga fora da lista continua aparecendo no item que a tem.
 *
 * As regras de cada uma (rótulo da quantidade, se pede medida) ficam em
 * `camposDaUnidade`, em tipos-de-produto.ts.
 */

export type UnidadeDoItem = { valor: string; rotulo: string; dica: string };

export const UNIDADES_DO_ITEM: readonly UnidadeDoItem[] = [
  { valor: "un", rotulo: "Unidade", dica: "peças contadas: cartão, brinde, placa pronta" },
  { valor: "m2", rotulo: "m² (por área)", dica: "lona, adesivo, vinil: pede largura × altura" },
  { valor: "m", rotulo: "Metro linear", dica: "bainha, fita, perfil" },
  { valor: "mil", rotulo: "Milheiro", dica: "1.000 folhas: panfleto, cartão" },
  { valor: "h", rotulo: "Hora", dica: "instalação, arte, serviço" },
  { valor: "kg", rotulo: "Quilo", dica: "material vendido a peso" },
  { valor: "km", rotulo: "Quilômetro", dica: "deslocamento" },
  { valor: "lote", rotulo: "Lote", dica: "conjunto vendido junto" },
  { valor: "peca", rotulo: "Peça", dica: "como a unidade, para quem prefere o nome" },
];

/** "M²", " m2 " e "metro2" viram a mesma chave. */
function chave(unidade: string): string {
  return unidade
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace("²", "2");
}

/**
 * O valor da lista que corresponde ao que está gravado ("m²" → "m2"), ou null
 * quando é uma unidade de fora da lista.
 */
export function unidadeDaLista(atual: string | null | undefined): string | null {
  const c = chave(atual ?? "");
  if (c === "") return "un";
  if (c === "metro2" || c === "metroquadrado") return "m2";
  if (c === "metro") return "m";
  if (c === "hora" || c === "horas") return "h";
  if (c === "milheiro") return "mil";
  return UNIDADES_DO_ITEM.find((u) => u.valor === c)?.valor ?? null;
}

/**
 * As opções do seletor para este item: a lista, mais a unidade antiga dele se
 * ela não está na lista — editar um item antigo não pode trocar a unidade dele
 * sem a pessoa pedir.
 */
export function opcoesDaUnidade(atual: string | null | undefined): UnidadeDoItem[] {
  const texto = (atual ?? "").trim();
  if (texto === "" || unidadeDaLista(texto) !== null) return [...UNIDADES_DO_ITEM];
  return [...UNIDADES_DO_ITEM, { valor: texto, rotulo: `${texto} (como estava)`, dica: "unidade antiga deste item" }];
}
