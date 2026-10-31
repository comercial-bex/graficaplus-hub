/**
 * O uso das impressoras por uma OS 3D (30/10/2026).
 *
 * Pedido do dono: com 100 kits e uma impressora que faz um kit por rodada, saber
 * quantas horas de máquina a OS pede e quanto cai se usar mais impressoras. Uma
 * "rodada" é uma placa na mesa: peças ÷ peças por placa, arredondado para cima
 * (a mesma conta do motor de custo: 100 kits de 110 min são 183 h). O dia útil
 * da agenda é de 10 h (08:00 às 18:00), de segunda a sexta.
 */

export const HORAS_POR_DIA_UTIL = 10;
/** Teto de rodadas por OS: acima disso o pedido é grande demais para virar jobs. */
export const MAXIMO_DE_RODADAS = 300;

export interface EntradaDoUso {
  pecas: number;
  /** Peças que cabem numa placa (mínimo 1). */
  pecasPorPlaca: number;
  /** Tempo de uma rodada, em minutos (impressão + setup + resfriamento + retirada). */
  minutosPorRodada: number;
}

export interface CenarioDeUso {
  maquinas: number;
  /** Rodadas da impressora mais carregada. */
  rodadasNaMaisCarregada: number;
  horasNaMaisCarregada: number;
  diasUteis: number;
}

export interface SimulacaoDeUso {
  rodadas: number;
  horasTotais: number;
  excedeOTeto: boolean;
  cenarios: CenarioDeUso[];
}

export function rodadasDoPedido(pecas: number, pecasPorPlaca: number): number {
  if (!(pecas > 0)) return 0;
  return Math.ceil(pecas / Math.max(Math.floor(pecasPorPlaca) || 1, 1));
}

/**
 * Reparte as rodadas entre as impressoras, sempre na menos carregada
 * (`cargaInicial` em minutos, uma por impressora). Devolve quantas rodadas
 * cada impressora recebe, na mesma ordem.
 */
export function repartirRodadas(rodadas: number, minutosPorRodada: number, cargaInicial: number[]): number[] {
  const carga = [...cargaInicial];
  const recebe = carga.map(() => 0);
  if (carga.length === 0) return recebe;
  for (let i = 0; i < rodadas; i++) {
    let menor = 0;
    for (let m = 1; m < carga.length; m++) if (carga[m] < carga[menor]) menor = m;
    carga[menor] += minutosPorRodada;
    recebe[menor] += 1;
  }
  return recebe;
}

/** De 1 até `maquinasDisponiveis` impressoras: quantas horas e dias úteis cada cenário pede. */
export function simularUso(entrada: EntradaDoUso, maquinasDisponiveis: number): SimulacaoDeUso {
  const rodadas = rodadasDoPedido(entrada.pecas, entrada.pecasPorPlaca);
  const minutos = Math.max(entrada.minutosPorRodada, 0);
  const cenarios: CenarioDeUso[] = [];
  for (let n = 1; n <= Math.max(maquinasDisponiveis, 1); n++) {
    const naMais = Math.ceil(rodadas / n);
    const horas = (naMais * minutos) / 60;
    cenarios.push({
      maquinas: n,
      rodadasNaMaisCarregada: naMais,
      horasNaMaisCarregada: Math.round(horas * 10) / 10,
      diasUteis: horas > 0 ? Math.ceil(horas / HORAS_POR_DIA_UTIL) : 0,
    });
  }
  return {
    rodadas,
    horasTotais: Math.round(((rodadas * minutos) / 60) * 10) / 10,
    excedeOTeto: rodadas > MAXIMO_DE_RODADAS,
    cenarios,
  };
}
