/**
 * A velocidade que o sistema usa para calcular o custo da Plotter i1600 (decisão do dono em 15/11/2026).
 *
 * A máquina faz 14 metros quadrados por hora, que é o número do catálogo. Só o custo calcula com 10, por margem de
 * segurança. A agenda e a capacidade seguem os 14. O banco aplica a velocidade de cálculo a qualquer máquina que a
 * tenha preenchida (coluna velocidade_calculo_m2_h); hoje é só a i1600. As telas que já têm a máquina leem os dois
 * números dela, e as constantes abaixo valem só para as telas que ainda não leem a máquina.
 * A tela diz isso em palavras, sempre que mostra a máquina ou um custo que depende dela.
 */

export const VELOCIDADE_NOMINAL_DA_PLOTTER = 14;
export const VELOCIDADE_DE_CALCULO_DA_PLOTTER = 10;

const numero = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Frase de margem de segurança. Sem parênteses, travessão ou seta. */
export function fraseDaVelocidade(nominal: number, usada: number): string {
  return `A máquina faz ${numero(nominal)} metros quadrados por hora. O custo é calculado com ${numero(usada)}, por margem de segurança. A agenda e a capacidade seguem os ${numero(nominal)}.`;
}

export const TEXTO_DA_VELOCIDADE_DA_PLOTTER = fraseDaVelocidade(
  VELOCIDADE_NOMINAL_DA_PLOTTER,
  VELOCIDADE_DE_CALCULO_DA_PLOTTER,
);

/** A máquina é a Plotter i1600? Reconhece pelo nome ou pelo modelo, sem depender de acento ou caixa. */
export function ehPlotterI1600(m: { nome?: string | null; modelo?: string | null }): boolean {
  return /i\s?1600/i.test(`${m.nome ?? ""} ${m.modelo ?? ""}`);
}

const positivo = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * A velocidade em metros quadrados por hora que o CUSTO usa numa linha de impressão.
 *
 * - Sem velocidade de cálculo na máquina (coluna vazia, zero ou inexistente no banco), vale o que valia antes:
 *   a do modo escolhido, ou a nominal da máquina.
 * - Com velocidade de cálculo e sem modo, ela vale como está.
 * - Com velocidade de cálculo e modo escolhido, o modo mantém a proporção: a margem de segurança da máquina
 *   (cálculo dividido pela nominal) é aplicada sobre a velocidade do modo. Na i1600, Produção de 14 vira 10,
 *   Rascunho de 28 vira 20 e Alta qualidade de 7 vira 5. Sem isso o modo padrão, que é igual à nominal,
 *   ignoraria a decisão do dono.
 *
 * Devolve 0 quando nada permite calcular, e quem chama trata 0 como "sem velocidade", nunca como tempo zero.
 */
export function velocidadeUsadaNoCusto(a: {
  nominal?: unknown;
  calculo?: unknown;
  modo?: unknown;
}): number {
  const nominal = positivo(a.nominal);
  const calculo = positivo(a.calculo);
  const modo = positivo(a.modo);
  if (calculo === 0) return modo || nominal;
  if (modo === 0 || nominal === 0) return calculo;
  return modo * (calculo / nominal);
}

/**
 * A velocidade que o custo usa numa máquina que a tela já leu: a de cálculo quando existe, senão a nominal.
 * É a mesma regra do banco (COALESCE da velocidade de cálculo, com zero tratado como vazio, e a nominal). Coluna
 * vazia na i1600 vale a nominal, porque é assim que o banco cobra: a tela nunca supõe uma velocidade que o banco não usa.
 */
export function velocidadeDoCustoDaMaquina(m: {
  velocidade_m2_h?: unknown;
  velocidade_calculo_m2_h?: unknown;
}): { nominal: number; usada: number; comMargem: boolean } {
  const nominal = positivo(m.velocidade_m2_h);
  const calculo = positivo(m.velocidade_calculo_m2_h);
  const usada = calculo > 0 ? calculo : nominal;
  return { nominal, usada, comMargem: usada > 0 && nominal > 0 && usada < nominal };
}
