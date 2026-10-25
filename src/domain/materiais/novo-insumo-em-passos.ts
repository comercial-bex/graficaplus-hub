/**
 * Novo insumo em passos (25/10/2026): bobina, chapa, tinta, filamento ou peça que entra no estoque.
 *
 * Mesma ideia do novo produto: uma pergunta por passo, a resposta em cartão. O que este assistente
 * acrescenta ao cadastro de antes é o que o aviso de compra precisa: o **estoque cheio** (máximo),
 * do qual o mínimo é 15% — "abaixo de 15% o sistema avisa para comprar, por causa da logística".
 * E a conta do custo: a pessoa informa o que PAGOU pela embalagem e o sistema divide pela medida
 * (a bobina de 1,6 × 50 m dá 80 m²), em vez de pedir um custo por m² que ninguém tem de cabeça.
 *
 * Este módulo é a regra, sem tela.
 */

export type NumeroDoPasso = 1 | 2 | 3 | 4 | 5 | 6;

export const PASSOS_DO_INSUMO: readonly { n: NumeroDoPasso; titulo: string; pergunta: string }[] = [
  { n: 1, titulo: "Tipo", pergunta: "O que entra no estoque?" },
  { n: 2, titulo: "Material", pergunta: "Qual material?" },
  { n: 3, titulo: "Marca", pergunta: "De quem é?" },
  { n: 4, titulo: "Medida", pergunta: "Qual o tamanho da embalagem?" },
  { n: 5, titulo: "Compra", pergunta: "Quanto pagou e quanto deve ter em estoque?" },
  { n: 6, titulo: "Revisão", pergunta: "Está tudo certo?" },
];

/** O aviso de compra dispara quando o saldo chega a esta fração do estoque cheio. */
export const FRACAO_DO_AVISO_DE_COMPRA = 0.15;

export type VarianteDeInsumo = { chave: string; titulo: string; nome: string; detalhe?: string };

export type TipoDeInsumo = {
  chave: "bobina" | "chapa" | "tinta" | "filamento" | "peca";
  titulo: string;
  detalhe: string;
  /** nome do ícone (lucide) — a tela resolve */
  icone: string;
  /** unidade em que o estoque é contado */
  unidade: "m²" | "ml" | "g" | "un";
  /** como a embalagem se chama na pergunta */
  embalagem: string;
  /** a medida da embalagem vem de largura × comprimento (bobina) ou largura × altura (chapa) */
  medida: "bobina" | "chapa" | "quantidade";
  /** quantidade de unidades por embalagem sugerida (tinta, filamento, peça) */
  quantidadePadrao?: number;
  variantes: readonly VarianteDeInsumo[];
};

export const LARGURAS_DE_BOBINA_M = [1.06, 1.27, 1.37, 1.52, 1.6, 1.8] as const;
export const COMPRIMENTOS_DE_BOBINA_M = [25, 30, 50] as const;
export const CHAPAS_COMUNS: readonly { titulo: string; largura: number; altura: number }[] = [
  { titulo: "1,22 × 2,44 m", largura: 1.22, altura: 2.44 },
  { titulo: "1,00 × 2,00 m", largura: 1, altura: 2 },
  { titulo: "1,50 × 3,00 m", largura: 1.5, altura: 3 },
  { titulo: "1,22 × 3,05 m", largura: 1.22, altura: 3.05 },
];

export const TIPOS_DE_INSUMO: readonly TipoDeInsumo[] = [
  {
    chave: "bobina",
    titulo: "Bobina / rolo",
    detalhe: "vinil, lona, laminação",
    icone: "Scroll",
    unidade: "m²",
    embalagem: "bobina",
    medida: "bobina",
    variantes: [
      { chave: "vinil-branco", titulo: "Vinil branco", nome: "Vinil adesivo branco brilho" },
      { chave: "vinil-perfurado", titulo: "Vinil perfurado", nome: "Vinil adesivo perfurado" },
      { chave: "vinil-transparente", titulo: "Vinil transparente", nome: "Vinil transparente" },
      { chave: "vinil-fosco", titulo: "Vinil fosco", nome: "Vinil fosco" },
      { chave: "vinil-blackout", titulo: "Vinil blackout", nome: "Vinil blackout" },
      { chave: "vinil-jateado", titulo: "Vinil jateado", nome: "Vinil jateado" },
      { chave: "laminacao", titulo: "Laminação", nome: "Laminação polimérica" },
      { chave: "lona-280", titulo: "Lona 280 g", nome: "Lona 280g brilho" },
      { chave: "lona-440", titulo: "Lona 440 g", nome: "Lona 440g reforçada" },
      { chave: "lona-fosca", titulo: "Lona fosca", nome: "Lona fosca" },
      { chave: "lona-backlight", titulo: "Lona backlight", nome: "Lona backlight" },
    ],
  },
  {
    chave: "chapa",
    titulo: "Chapa",
    detalhe: "ACM, PS, PVC, acrílico",
    icone: "Square",
    unidade: "m²",
    embalagem: "chapa",
    medida: "chapa",
    variantes: [
      { chave: "acm", titulo: "ACM 3 mm", nome: "Chapa ACM 3mm" },
      { chave: "ps", titulo: "PS 2 mm", nome: "Chapa PS 2mm" },
      { chave: "pvc", titulo: "PVC expandido 3 mm", nome: "Chapa PVC expandido 3mm" },
      {
        chave: "acrilico-cristal",
        titulo: "Acrílico cristal",
        nome: "Acrílico cristal virgem 3mm",
      },
      { chave: "acrilico-branco", titulo: "Acrílico branco", nome: "Acrílico branco virgem 3mm" },
      { chave: "acrilico-preto", titulo: "Acrílico preto", nome: "Acrílico preto virgem 3mm" },
    ],
  },
  {
    chave: "tinta",
    titulo: "Tinta e líquidos",
    detalhe: "solvente, eco-solvente, UV",
    icone: "Droplets",
    unidade: "ml",
    embalagem: "frasco",
    medida: "quantidade",
    quantidadePadrao: 1000,
    variantes: [
      { chave: "solvente", titulo: "Solvente", nome: "Tinta solvente (conjunto)" },
      { chave: "eco", titulo: "Eco-solvente", nome: "Tinta eco-solvente" },
      { chave: "uv", titulo: "UV", nome: "Tinta UV" },
    ],
  },
  {
    chave: "filamento",
    titulo: "Filamento 3D",
    detalhe: "PLA, PETG, ABS, TPU",
    icone: "Cylinder",
    unidade: "g",
    embalagem: "carretel",
    medida: "quantidade",
    quantidadePadrao: 1000,
    variantes: [
      { chave: "pla", titulo: "PLA", nome: "Filamento PLA" },
      { chave: "petg", titulo: "PETG", nome: "Filamento PETG" },
      { chave: "abs", titulo: "ABS", nome: "Filamento ABS" },
      { chave: "asa", titulo: "ASA", nome: "Filamento ASA" },
      { chave: "tpu", titulo: "TPU", nome: "Filamento TPU" },
    ],
  },
  {
    chave: "peca",
    titulo: "Peça e acessório",
    detalhe: "ilhós, bastão, ventosa",
    icone: "Puzzle",
    unidade: "un",
    embalagem: "pacote",
    medida: "quantidade",
    quantidadePadrao: 100,
    variantes: [
      { chave: "ilhos", titulo: "Ilhós", nome: "Ilhós metálico" },
      { chave: "bastao", titulo: "Bastão e corda", nome: "Bastão + corda para banner" },
      { chave: "ventosa", titulo: "Ventosa", nome: "Ventosa para banner" },
      { chave: "outra", titulo: "Outra peça", nome: "" },
    ],
  },
];

export type RespostasDoInsumo = {
  tipo: TipoDeInsumo | null;
  variante: VarianteDeInsumo | null;
  fornecedor: string;
  largura: string;
  comprimento: string;
  quantidadeNaEmbalagem: string;
  precoDaEmbalagem: string;
  estoqueCheio: string;
  embalagensAgora: string;
  nome: string;
  localizacao: string;
};

export const RESPOSTAS_VAZIAS_DO_INSUMO: RespostasDoInsumo = {
  tipo: null,
  variante: null,
  fornecedor: "",
  largura: "",
  comprimento: "",
  quantidadeNaEmbalagem: "",
  precoDaEmbalagem: "",
  estoqueCheio: "",
  embalagensAgora: "",
  nome: "",
  localizacao: "",
};

const num = (t: string) => {
  const n = Number(String(t).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const arred = (n: number, casas = 2) => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Quantas unidades do estoque vêm em UMA embalagem (m², ml, g ou un). */
export function quantidadePorEmbalagem(r: RespostasDoInsumo): number {
  if (!r.tipo) return 0;
  if (r.tipo.medida === "quantidade") return num(r.quantidadeNaEmbalagem);
  return arred(num(r.largura) * num(r.comprimento), 3);
}

/** Custo por unidade do estoque: o que pagou dividido pelo que veio. 0 quando falta um dos dois. */
export function custoPorUnidade(r: RespostasDoInsumo): number {
  const q = quantidadePorEmbalagem(r);
  const preco = num(r.precoDaEmbalagem);
  return q > 0 && preco > 0 ? arred(preco / q, 4) : 0;
}

/** O mínimo (aviso de compra) é 15% do estoque cheio. */
export function estoqueMinimoDoCheio(estoqueCheio: number): number {
  return estoqueCheio > 0 ? arred(estoqueCheio * FRACAO_DO_AVISO_DE_COMPRA) : 0;
}

/** Quanto entra no estoque agora (embalagens × medida da embalagem). */
export function entradaInicial(r: RespostasDoInsumo): number {
  return arred(num(r.embalagensAgora) * quantidadePorEmbalagem(r), 3);
}

/** Por que o passo ainda não pode avançar, ou nada. */
export function pendenciaDoPassoDoInsumo(
  passo: NumeroDoPasso,
  r: RespostasDoInsumo,
): string | null {
  switch (passo) {
    case 1:
      return r.tipo ? null : "Escolha o que entra no estoque.";
    case 2:
      return r.variante ? null : "Escolha o material.";
    case 3:
      return null; // marca é opcional
    case 4:
      return quantidadePorEmbalagem(r) > 0
        ? null
        : r.tipo?.medida === "quantidade"
          ? `Diga quantos ${r.tipo.unidade} vêm em cada ${r.tipo.embalagem}.`
          : "Informe a largura e o comprimento.";
    case 5: {
      const cheio = num(r.estoqueCheio);
      if (r.estoqueCheio.trim() !== "" && cheio <= 0)
        return "O estoque cheio precisa ser maior que zero.";
      if (num(r.embalagensAgora) > 0 && num(r.precoDaEmbalagem) <= 0) {
        return "Para dar entrada agora, informe o que pagou pela embalagem.";
      }
      return null;
    }
    case 6:
      return r.nome.trim() ? null : "Dê um nome ao material.";
  }
}

/** A linha de `materiais`, na forma da tabela. O saldo nasce zero: a entrada é por RPC. */
export function materialDasRespostas(r: RespostasDoInsumo) {
  const custo = custoPorUnidade(r);
  const cheio = num(r.estoqueCheio);
  const partes: string[] = [];
  if (r.tipo?.medida === "bobina" && num(r.largura) > 0) {
    partes.push(`largura ${num(r.largura).toLocaleString("pt-BR")} m`);
    if (num(r.comprimento) > 0)
      partes.push(`bobina de ${num(r.comprimento).toLocaleString("pt-BR")} m`);
  }
  if (r.tipo?.medida === "chapa" && num(r.largura) > 0 && num(r.comprimento) > 0) {
    partes.push(
      `chapa de ${num(r.largura).toLocaleString("pt-BR")} × ${num(r.comprimento).toLocaleString("pt-BR")} m`,
    );
  }
  if (r.tipo?.medida === "quantidade" && num(r.quantidadeNaEmbalagem) > 0) {
    partes.push(
      `${r.tipo.embalagem} de ${num(r.quantidadeNaEmbalagem).toLocaleString("pt-BR")} ${r.tipo.unidade}`,
    );
  }
  return {
    nome: r.nome.trim(),
    caracteristicas: partes.join(", ") || null,
    unidade: r.tipo?.unidade ?? "un",
    estoque: 0,
    estoque_minimo: estoqueMinimoDoCheio(cheio),
    estoque_maximo: cheio > 0 ? cheio : null,
    fornecedor: r.fornecedor.trim() || null,
    localizacao: r.localizacao.trim() || null,
    custo_unitario: custo > 0 ? custo : null,
    custo_medio: custo > 0 ? custo : null,
    largura_bobina_m: r.tipo?.medida === "bobina" && num(r.largura) > 0 ? num(r.largura) : null,
    comprimento_bobina_m:
      r.tipo?.medida === "bobina" && num(r.comprimento) > 0 ? num(r.comprimento) : null,
  };
}
