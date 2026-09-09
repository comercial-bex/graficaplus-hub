/**
 * Encargos sobre a mão de obra.
 *
 * As cinco funções da casa estão a R$ 40/h com 0% de encargos. R$ 40 é o
 * salário-hora — o que sai do bolso da empresa por aquela hora é bem mais, e a
 * diferença vai direto para dentro do preço de cada peça.
 *
 * Este módulo NÃO escolhe a alíquota. Ele quebra o encargo nas parcelas que
 * existem na lei e deixa cada uma à vista, porque o total depende do regime
 * tributário e de decisões da empresa (vale-transporte, plano, provisão de
 * rescisão que a casa assume). Um número redondo de 70% escondido no código
 * seria o mesmo erro do custo/hora zerado, só que ao contrário.
 *
 * As parcelas abaixo são as previstas em lei; os valores são as alíquotas
 * correntes e ficam expostos para conferência com a contabilidade.
 */

export type ParcelaEncargo = {
  chave: string;
  rotulo: string;
  /** fração do salário */
  aliquota: number;
  /** true quando só incide fora do Simples Nacional */
  foraDoSimples?: boolean;
  nota: string;
};

export const PARCELAS: ParcelaEncargo[] = [
  { chave: "fgts", rotulo: "FGTS", aliquota: 0.08, nota: "8% sobre a remuneração, todo mês" },
  { chave: "decimo", rotulo: "13º salário", aliquota: 0.0833, nota: "um salário por ano = 1/12 ao mês" },
  { chave: "ferias", rotulo: "Férias + 1/3", aliquota: 0.1111, nota: "um salário e um terço por ano" },
  { chave: "fgts_sobre", rotulo: "FGTS sobre 13º e férias", aliquota: 0.0155, nota: "os 8% incidem também sobre eles" },
  { chave: "rescisao", rotulo: "Provisão de rescisão", aliquota: 0.032, nota: "multa de 40% do FGTS, provisionada" },
  { chave: "inss", rotulo: "INSS patronal", aliquota: 0.20, foraDoSimples: true, nota: "20% — empresa no Simples não recolhe" },
  { chave: "rat", rotulo: "RAT", aliquota: 0.02, foraDoSimples: true, nota: "risco ambiental do trabalho, 1% a 3%" },
  { chave: "terceiros", rotulo: "Terceiros (Sistema S)", aliquota: 0.058, foraDoSimples: true, nota: "SESI, SENAI, SEBRAE e outros" },
];

const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Soma das parcelas escolhidas. Nenhuma é obrigatória: quem escolhe é a casa. */
export function somarEncargos(chaves: string[]): number {
  const set = new Set(chaves);
  return r4(PARCELAS.filter((p) => set.has(p.chave)).reduce((s, p) => s + p.aliquota, 0));
}

/** As parcelas de um regime, como ponto de partida para marcar ou desmarcar. */
export function parcelasDoRegime(regime: "simples" | "fora_do_simples"): string[] {
  return PARCELAS.filter((p) => regime === "fora_do_simples" || !p.foraDoSimples).map((p) => p.chave);
}

export type CustoDaHora = {
  salarioHora: number;
  encargosPct: number;
  custoHora: number;
  /** quanto o encargo acrescenta, em reais por hora */
  acrescimo: number;
};

/**
 * Custo real da hora a partir do salário mensal.
 *
 * As horas do mês são as CONTRATADAS (220 na jornada de 44h semanais), não as
 * horas produtivas: o salário é pago pelas 220 tenha a máquina rodado ou não.
 * Dividir pelas produtivas embutiria ociosidade duas vezes, porque a ociosidade
 * já entra no custo/hora da máquina.
 */
export function custoDaHora(entrada: {
  salarioMensal: number;
  horasMensais?: number;
  encargosPct: number;
}): CustoDaHora {
  // `!= null` e não `||`: com `0 || 220` uma jornada zerada cairia no padrão e
  // devolveria R$ 17,73 de custo/hora — plausível, e vindo de entrada inválida.
  // É o mesmo "zero disfarçado" que já mordeu na troca de peça da fiber.
  const horas = entrada.horasMensais != null ? num(entrada.horasMensais) : 220;
  const salario = num(entrada.salarioMensal);
  const enc = Math.max(0, num(entrada.encargosPct));
  if (horas <= 0 || salario <= 0) {
    return { salarioHora: 0, encargosPct: enc, custoHora: 0, acrescimo: 0 };
  }
  const salarioHora = salario / horas;
  const custoHora = salarioHora * (1 + enc);
  return {
    salarioHora: r2(salarioHora),
    encargosPct: enc,
    custoHora: r2(custoHora),
    acrescimo: r2(custoHora - salarioHora),
  };
}

/**
 * Quanto um orçamento subestima quando os encargos estão zerados.
 *
 * Devolve a fração que FALTA sobre o custo lançado — com 70% de encargo
 * ignorado, o bloco de mão de obra está 41% menor do que devia
 * (1 − 1/1,7), e não 70% menor. É a diferença entre assustar e informar.
 */
export function quantoFalta(encargosReais: number): number {
  const e = Math.max(0, num(encargosReais));
  if (e === 0) return 0;
  return r4(1 - 1 / (1 + e));
}
