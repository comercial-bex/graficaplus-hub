/**
 * A velocidade que o sistema usa para calcular o custo da Plotter i1600 (decisão do dono em 15/11/2026).
 *
 * A máquina faz 14 metros quadrados por hora, que é o número do catálogo. O custo e o tempo de produção saem com 10,
 * por margem de segurança. Vale só para a i1600: as outras máquinas calculam com a velocidade nominal.
 * A tela diz isso em palavras, sempre que mostra a máquina ou um custo que depende dela.
 */

export const VELOCIDADE_NOMINAL_DA_PLOTTER = 14;
export const VELOCIDADE_DE_CALCULO_DA_PLOTTER = 10;

const numero = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Frase de margem de segurança. Sem parênteses, travessão ou seta. */
export function fraseDaVelocidade(nominal: number, usada: number): string {
  return `A máquina faz ${numero(nominal)} metros quadrados por hora e o sistema calcula com ${numero(usada)} por margem de segurança.`;
}

export const TEXTO_DA_VELOCIDADE_DA_PLOTTER = fraseDaVelocidade(
  VELOCIDADE_NOMINAL_DA_PLOTTER,
  VELOCIDADE_DE_CALCULO_DA_PLOTTER,
);

/** A máquina é a Plotter i1600? Reconhece pelo nome ou pelo modelo, sem depender de acento ou caixa. */
export function ehPlotterI1600(m: { nome?: string | null; modelo?: string | null }): boolean {
  return /i\s?1600/i.test(`${m.nome ?? ""} ${m.modelo ?? ""}`);
}
