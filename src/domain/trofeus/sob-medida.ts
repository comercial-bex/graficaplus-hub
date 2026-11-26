/**
 * COTAR AS PEÇAS DA FICHA, SEM MODELO CADASTRADO (26/11/2026). Função pura: sem banco, sem React, sem rede e SEM PREÇO.
 *
 * Os três modelos (econômico, padrão e premium) cotam sozinhos. Uma ficha de fabricação de fora (o JariCross 10 Anos,
 * por exemplo) traz peças que nenhum modelo tem: placa de 6 mm, base de 10 mm, plaqueta de prata. O dono decidiu
 * (22/11/2026) que dá para orçar SEM ter a chapa e SEM o material estar no estoque; falta só o custo do m² de cada
 * material. Este arquivo transforma a lista de peças da ficha num modelo "de passagem" que a MESMA conta
 * (`calcularTrofeu`, via `cotarTrofeuComABase`) sabe cotar. Nada aqui calcula preço: quem monta as taxas e faz a conta
 * é o servidor (`cotarFichaSobMedida`), com a chave de serviço, como no `cotarTrofeu`.
 *
 * Regras que os testes travam (`tests/trofeus-sob-medida.test.ts`):
 *   * o custo do m² é do material NAQUELA espessura: só vale como substituto um material da MESMA espessura da peça
 *     (a placa de 10 mm nunca é cotada com o preto de 3 mm, que sairia umas três vezes mais barata);
 *   * a mão de obra e o multiplicador seguem a linha Padrão, na altura pedida (decisão de partida, ainda estimativa);
 *   * peça com material trocado leva aviso ("cotada com X no lugar de Y") e o preço dela é estimativa;
 *   * as mesmas peças de um modelo cadastrado, na altura dele, dão EXATAMENTE o preço desse modelo.
 */
import type { Decoracao } from "./conta";
import type { LinhaDaPeca, LinhaDoModelo } from "./cotacao";

export const LIMITES_SOB_MEDIDA = {
  pecasMaximas: 20,
  nomeMaximo: 80,
  medidaMinimaCm: 0.5,
  medidaMaximaCm: 200,
  quantidadeMaximaPorTrofeu: 50,
  fatorDeFormaMinimo: 1,
  fatorDeFormaMaximo: 3,
} as const;

export const DECORACOES_SOB_MEDIDA: readonly Decoracao[] = [
  "nenhuma",
  "vinil_laminado",
  "gravacao_laser",
];

/** Uma peça como o servidor a recebe: medidas em centímetros, como a ficha as escreve. */
export type PecaSobMedida = {
  nome: string;
  /** O material do CADASTRO escolhido para o custo. */
  materialId: string;
  /** A espessura que a ficha pede (mm). Tem de ser a do material escolhido. */
  espessuraMm: number;
  larguraCm: number;
  alturaCm: number;
  /** Por troféu. */
  quantidade: number;
  decoracao: Decoracao;
  /** Perímetro real ÷ perímetro do retângulo. 1 = retângulo; contorno recortado passa de 1. */
  fatorDeForma: number;
  /** O material como a ficha escreveu, quando a peça foi cotada com OUTRO. Nulo quando é o próprio. */
  materialPedido: string | null;
};

/** O que a tela e o servidor sabem de um material do cadastro: nome, espessura, unidade. Nunca custo. */
export type MaterialParaSobMedida = {
  id?: string;
  nome: string;
  espessuraMm: number | null;
  unidade?: string | null;
};

/** Mesma espessura, com tolerância de 0,05 mm: o custo por m² da chapa é daquela espessura. */
export const mesmaEspessuraDaChapa = (
  pedidaMm: number,
  doMaterialMm: number | null | undefined,
): boolean => doMaterialMm != null && Math.abs(pedidaMm - Number(doMaterialMm)) < 0.05;

/** Chapas (m²) do cadastro com id e da mesma espessura da peça: as únicas que podem dar o custo dela. */
export function materiaisCompativeis<T extends MaterialParaSobMedida>(
  espessuraMm: number,
  materiais: T[],
): (T & { id: string })[] {
  if (!(espessuraMm > 0)) return [];
  return materiais.filter(
    (m): m is T & { id: string } =>
      typeof m.id === "string" &&
      m.id !== "" &&
      (m.unidade == null || m.unidade === "m²") &&
      mesmaEspessuraDaChapa(espessuraMm, m.espessuraMm),
  );
}

const emMm = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

function problemaDaPeca(p: PecaSobMedida, n: number): string | null {
  const nome = p.nome.trim();
  const de = `A peça ${n}${nome ? ` ("${nome}")` : ""}`;
  if (nome === "") return `${de} está sem nome.`;
  if (nome.length > LIMITES_SOB_MEDIDA.nomeMaximo)
    return `${de} tem nome longo demais (até ${LIMITES_SOB_MEDIDA.nomeMaximo} letras).`;
  if (!p.materialId) return `${de} está sem material. Escolha um material do cadastro.`;
  if (!Number.isFinite(p.espessuraMm) || p.espessuraMm <= 0) return `${de} está sem espessura.`;
  for (const [rotulo, valor] of [
    ["largura", p.larguraCm],
    ["altura", p.alturaCm],
  ] as const) {
    if (
      !Number.isFinite(valor) ||
      valor < LIMITES_SOB_MEDIDA.medidaMinimaCm ||
      valor > LIMITES_SOB_MEDIDA.medidaMaximaCm
    ) {
      return `${de} está com ${rotulo} fora do que o sistema aceita (de ${emMm(LIMITES_SOB_MEDIDA.medidaMinimaCm)} a ${LIMITES_SOB_MEDIDA.medidaMaximaCm} cm).`;
    }
  }
  if (
    !Number.isInteger(p.quantidade) ||
    p.quantidade < 1 ||
    p.quantidade > LIMITES_SOB_MEDIDA.quantidadeMaximaPorTrofeu
  ) {
    return `${de} precisa de uma quantidade inteira, de 1 a ${LIMITES_SOB_MEDIDA.quantidadeMaximaPorTrofeu} por troféu.`;
  }
  if (!DECORACOES_SOB_MEDIDA.includes(p.decoracao))
    return `${de} está com uma decoração que o troféu não conhece.`;
  if (
    !Number.isFinite(p.fatorDeForma) ||
    p.fatorDeForma < LIMITES_SOB_MEDIDA.fatorDeFormaMinimo ||
    p.fatorDeForma > LIMITES_SOB_MEDIDA.fatorDeFormaMaximo
  ) {
    return `${de} está com o fator de forma fora do que o sistema aceita (de ${LIMITES_SOB_MEDIDA.fatorDeFormaMinimo} a ${LIMITES_SOB_MEDIDA.fatorDeFormaMaximo}).`;
  }
  return null;
}

/** A primeira frase de problema da lista de peças, em português, ou nulo se pode cotar. */
export function conferirPecasSobMedida(pecas: PecaSobMedida[]): string | null {
  if (pecas.length === 0) return "Liste ao menos uma peça para cotar.";
  if (pecas.length > LIMITES_SOB_MEDIDA.pecasMaximas)
    return `O sistema cota até ${LIMITES_SOB_MEDIDA.pecasMaximas} peças por troféu.`;
  for (let i = 0; i < pecas.length; i++) {
    const p = problemaDaPeca(pecas[i], i + 1);
    if (p) return p;
  }
  return null;
}

/** A referência de mão de obra e multiplicador: a linha Padrão cadastrada. */
export type ReferenciaDoSobMedida = {
  altura_referencia_m: unknown;
  minutos_de_mao_de_obra: unknown;
  multiplicador_base: unknown;
};

export const NOME_DO_SOB_MEDIDA = "Sob medida (peças da ficha)";

/**
 * O modelo de passagem no formato das linhas do banco, para a MESMA `cotarTrofeuComABase` cotar. A altura de
 * referência é a altura pedida (escala 1: as peças já estão no tamanho do troféu) e os minutos de mão de obra da
 * linha Padrão crescem na proporção da altura, como crescem no modelo.
 */
export function linhasDoSobMedida(
  pecas: PecaSobMedida[],
  alturaCm: number,
  referencia: ReferenciaDoSobMedida,
): { modelo: LinhaDoModelo; pecas: LinhaDaPeca[] } {
  // Em milímetros inteiros, como `cotarTrofeuComABase` faz com a altura: 18 cm vira 0,18 m sem sujeira de ponto flutuante.
  const alturaM = Math.round(alturaCm * 10) / 1000;
  const alturaDaReferenciaM = Number(referencia.altura_referencia_m);
  const minutosDaReferencia = Number(referencia.minutos_de_mao_de_obra);
  const proporcao = alturaDaReferenciaM > 0 ? alturaM / alturaDaReferenciaM : 1;
  return {
    modelo: {
      id: "sob-medida",
      nome: NOME_DO_SOB_MEDIDA,
      linha: "padrao",
      altura_referencia_m: alturaM,
      minutos_de_mao_de_obra: Math.round(minutosDaReferencia * proporcao * 10000) / 10000,
      multiplicador_base: referencia.multiplicador_base,
      ativo: true,
      provisorio: false,
    },
    pecas: pecas.map((p, i) => ({
      ordem: i + 1,
      nome: p.nome.trim(),
      material_id: p.materialId,
      espessura_mm: p.espessuraMm,
      largura_m: Math.round(p.larguraCm * 10) / 1000,
      altura_m: Math.round(p.alturaCm * 10) / 1000,
      quantidade: p.quantidade,
      fator_de_forma: p.fatorDeForma,
      decoracao: p.decoracao,
    })),
  };
}

/** Os avisos do sob medida: sem número de custo, só nomes. */
export function avisosDoSobMedida(
  pecas: PecaSobMedida[],
  nomeDoMaterial: (id: string) => string | null,
): string[] {
  const avisos = [
    "Cotação sob medida: as peças vêm da ficha, não de um modelo cadastrado. A mão de obra e a regra de preço seguem a linha Padrão.",
  ];
  for (const p of pecas) {
    const nome = nomeDoMaterial(p.materialId);
    if (p.materialPedido && nome) {
      avisos.push(
        `A peça "${p.nome.trim()}" foi cotada com ${nome} no lugar de "${p.materialPedido}": o preço dela é uma estimativa até esse material ter custo no cadastro.`,
      );
    }
  }
  return [...new Set(avisos)];
}
