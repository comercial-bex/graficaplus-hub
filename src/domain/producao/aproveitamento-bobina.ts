/**
 * Aproveitamento de bobina: quantas peças saem do rolo que está na máquina.
 *
 * É a conta que decide se um pedido cabe, quantos metros lineares ele consome e
 * quanto material vira sobra. O preço por m² do catálogo é cobrado sobre a
 * BOBINA CONSUMIDA, não sobre a área da peça pronta — e a diferença entre as
 * duas é exatamente o que esta função calcula.
 *
 * Quatro parâmetros mandam no resultado:
 *   - largura útil da máquina (a boca de impressão);
 *   - largura da bobina carregada;
 *   - margem lateral (a impressora não imprime até a borda);
 *   - espaçamento entre peças (a faca precisa de espaço para contornar).
 *
 * O gargalo é sempre o menor entre a boca da máquina e a largura da bobina:
 * uma máquina de 1,80 m com bobina de 1,06 m imprime 1,06 m.
 */

export type EntradaBobina = {
  /** metros */
  larguraPeca: number;
  /** metros */
  alturaPeca: number;
  quantidade: number;
  /** metros — a bobina carregada */
  larguraBobina: number;
  /** metros — a boca de impressão da máquina */
  larguraUtilMaquina: number;
  /** metros de cada lado; padrão 1 cm */
  margemLateral?: number;
  /** metros entre peças, para o recorte; padrão 3 mm */
  espacamento?: number;
  /** girar a peça 90° quando render mais por fileira */
  permitirRotacao?: boolean;
};

export type PlanoBobina = {
  /** largura realmente aproveitável depois da margem */
  larguraUtilizavel: number;
  /** peças lado a lado numa fileira */
  colunas: number;
  /** fileiras necessárias para a quantidade pedida */
  linhas: number;
  /** metros lineares de bobina consumidos */
  metrosLineares: number;
  /** m² de bobina consumidos — a largura inteira do rolo entra na conta */
  m2Consumidos: number;
  /** m² úteis das peças ÷ m² consumidos */
  aproveitamentoPct: number;
  /** sobra de largura que não coube em mais uma coluna, em metros */
  sobraLateral: number;
  /** quantas peças saem de um metro linear */
  pecasPorMetroLinear: number;
  orientacao: "normal" | "girada";
};

export type ResultadoBobina =
  | { cabe: true; plano: PlanoBobina }
  | { cabe: false; motivo: string };

const arred = (n: number, casas = 3) => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/**
 * Quantas peças de `largura` cabem lado a lado em `disponivel`.
 *
 * n peças ocupam n·largura + (n−1)·espaçamento, então
 * n ≤ (disponível + espaçamento) ÷ (largura + espaçamento).
 * O espaçamento entra no numerador porque a última peça não tem vizinha à
 * direita — esquecer isso perde uma coluna em peça pequena, que é justamente
 * onde a coluna a mais faz diferença.
 */
export function colunasQueCabem(disponivel: number, largura: number, espacamento: number): number {
  if (largura <= 0 || disponivel < largura) return 0;
  return Math.floor((disponivel + espacamento) / (largura + espacamento));
}

export function planejarBobina(entrada: EntradaBobina): ResultadoBobina {
  const margem = entrada.margemLateral ?? 0.01;
  const espaco = entrada.espacamento ?? 0.003;
  const permitirRotacao = entrada.permitirRotacao ?? true;

  if (entrada.quantidade <= 0) return { cabe: false, motivo: "Informe a quantidade." };
  if (entrada.larguraPeca <= 0 || entrada.alturaPeca <= 0) {
    return { cabe: false, motivo: "Informe as medidas da peça." };
  }
  if (entrada.larguraBobina <= 0 || entrada.larguraUtilMaquina <= 0) {
    return {
      cabe: false,
      motivo: "Cadastre a largura da bobina e a largura de impressão da máquina.",
    };
  }

  // O gargalo é o menor dos dois: bobina maior que a boca não ajuda, e boca
  // maior que a bobina não inventa material.
  const largura = Math.min(entrada.larguraBobina, entrada.larguraUtilMaquina);
  const larguraUtilizavel = arred(largura - 2 * margem);

  if (larguraUtilizavel <= 0) {
    return { cabe: false, motivo: "A margem lateral consome toda a largura disponível." };
  }

  const opcoes: PlanoBobina[] = [];
  const orientacoes: { nome: "normal" | "girada"; l: number; a: number }[] = [
    { nome: "normal", l: entrada.larguraPeca, a: entrada.alturaPeca },
  ];
  if (permitirRotacao && entrada.larguraPeca !== entrada.alturaPeca) {
    orientacoes.push({ nome: "girada", l: entrada.alturaPeca, a: entrada.larguraPeca });
  }

  for (const o of orientacoes) {
    const colunas = colunasQueCabem(larguraUtilizavel, o.l, espaco);
    if (colunas === 0) continue;

    const linhas = Math.ceil(entrada.quantidade / colunas);
    // A última fileira não precisa do espaçamento depois dela.
    const metrosLineares = arred(linhas * (o.a + espaco) - espaco);
    // Consome a largura INTEIRA do rolo, inclusive a faixa lateral que sobrou:
    // aquele material não volta para a prateleira.
    const m2Consumidos = arred(entrada.larguraBobina * metrosLineares, 4);
    const m2Uteis = entrada.larguraPeca * entrada.alturaPeca * entrada.quantidade;

    opcoes.push({
      larguraUtilizavel,
      colunas,
      linhas,
      metrosLineares,
      m2Consumidos,
      aproveitamentoPct: m2Consumidos > 0 ? arred(m2Uteis / m2Consumidos, 4) : 0,
      sobraLateral: arred(larguraUtilizavel - (colunas * o.l + (colunas - 1) * espaco)),
      pecasPorMetroLinear: arred(colunas / (o.a + espaco), 2),
      orientacao: o.nome,
    });
  }

  if (opcoes.length === 0) {
    return {
      cabe: false,
      motivo: `A peça não cabe na largura disponível de ${larguraUtilizavel.toFixed(2)} m. Use uma bobina mais larga ou divida a arte.`,
    };
  }

  // Menos metro linear é menos material e menos tempo de máquina.
  opcoes.sort((a, b) => a.metrosLineares - b.metrosLineares);
  return { cabe: true, plano: opcoes[0] };
}
