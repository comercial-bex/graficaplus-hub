import { BOBINAS } from "./capacidade-da-casa";
import type { MaterialDaCasa } from "./tabela-terceirizados";
import { simularPedido } from "./simulador-de-balcao";
import type { Cenario } from "./cenarios-de-balcao";

/**
 * Do consumo simulado ao estoque que a casa deveria ter.
 *
 * PREMISSAS (a confirmar com o dono):
 *  - prazo de reposição: dias entre pedir ao fornecedor e o rolo chegar (logística);
 *  - o aviso de compra dispara quando o estoque cai a `avisoPct` do estoque cheio (15%);
 *  - estoque cheio = o que cobre o consumo do prazo de reposição + a folga, de modo que o
 *    aviso (15% do cheio) ainda aguente o prazo: cheio = consumoNoPrazo / avisoPct.
 */
export type PremissasDeEstoque = {
  /** pedidos iguais ao cenário por dia útil */
  pedidosPorDia: number;
  prazoDeReposicaoDias: number;
  avisoPct: number;
  diasUteisPorMes: number;
};

export const PREMISSAS_DE_ESTOQUE: PremissasDeEstoque = {
  pedidosPorDia: 1,
  prazoDeReposicaoDias: 7,
  avisoPct: 0.15,
  diasUteisPorMes: 22,
};

export type NecessidadeDeEstoque = {
  material: MaterialDaCasa;
  nome: string;
  consumoDiaM2: number;
  consumoMesM2: number;
  /** m² que o estoque precisa cobrir enquanto a compra não chega */
  consumoNoPrazoM2: number;
  /** estoque cheio sugerido */
  estoqueCheioM2: number;
  /** nível de aviso: abaixo disto, comprar */
  avisoEmM2: number;
};

/** Soma o consumo de material de um conjunto de cenários, tratando-o como um dia de balcão. */
export function necessidadeDeEstoque(
  cenarios: Cenario[],
  premissas: PremissasDeEstoque = PREMISSAS_DE_ESTOQUE,
): NecessidadeDeEstoque[] {
  const porDia: Partial<Record<MaterialDaCasa, number>> = {};
  for (const c of cenarios) {
    const r = simularPedido(c.itens, { ...c.opcoes, estoque: "abastecido" });
    for (const [m, v] of Object.entries(r.material.consumoM2) as [MaterialDaCasa, number][]) {
      porDia[m] = (porDia[m] ?? 0) + v * premissas.pedidosPorDia;
    }
  }
  const arred = (n: number) => Math.round(n * 100) / 100;
  return (Object.entries(porDia) as [MaterialDaCasa, number][])
    .map(([material, dia]) => {
      const noPrazo = dia * premissas.prazoDeReposicaoDias;
      const cheio = noPrazo / premissas.avisoPct;
      return {
        material,
        nome: BOBINAS[material].nome,
        consumoDiaM2: arred(dia),
        consumoMesM2: arred(dia * premissas.diasUteisPorMes),
        consumoNoPrazoM2: arred(noPrazo),
        estoqueCheioM2: arred(cheio),
        avisoEmM2: arred(cheio * premissas.avisoPct),
      };
    })
    .sort((a, b) => b.consumoDiaM2 - a.consumoDiaM2);
}

/**
 * Um dia de balcão de ilustração: pedidos comuns, sem os gigantes (S13, S19) nem os de teste de
 * limite. Só serve para dar ordem de grandeza; o número de verdade vem do histórico de
 * consumo (jobs do Flexi) quando houver.
 */
export const DIA_TIPICO = [
  "S01",
  "S02",
  "S03",
  "S04",
  "S05",
  "S07",
  "S10",
  "S12",
  "S15",
  "S17",
  "S21",
];
