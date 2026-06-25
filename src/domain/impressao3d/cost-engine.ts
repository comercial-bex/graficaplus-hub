import { D, Decimal } from "./decimal";

export type PrecisionLevel = "estimativa_preliminar" | "validado_pelo_fatiador" | "reconciliado" | "realizado";
export const MOTOR_VERSION = "3d-cost-engine-v1";

export function materialCostPerGram(input: { compra: string|number; freteRateado?: string|number; tributosAquisicao?: string|number; outrosCustos?: string|number; descontos?: string|number; pesoLiquidoG: string|number; fatorAproveitamento: string|number }) {
  const liquido = D(input.compra).add(input.freteRateado ?? 0).add(input.tributosAquisicao ?? 0).add(input.outrosCustos ?? 0).sub(input.descontos ?? 0);
  const pesoUtil = D(input.pesoLiquidoG).mul(input.fatorAproveitamento);
  if (!pesoUtil.gt(0)) throw new Error("Peso útil do filamento deve ser maior que zero");
  return liquido.div(pesoUtil);
}

export function totalGrams(parts: Record<"modelo"|"suporte"|"purga"|"torre"|"preparacao"|"extras", string|number>) {
  return D(parts.modelo).add(parts.suporte).add(parts.purga).add(parts.torre).add(parts.preparacao).add(parts.extras);
}

export function materialCost(grams: Decimal, costPerGramSnapshot: string|number|Decimal) {
  return grams.mul(costPerGramSnapshot);
}

export function machineHourCostA(input: { custoAquisicao: string|number; frete: string|number; instalacao: string|number; acessoriosCapitalizados: string|number; valorResidual: string|number; vidaUtilHoras: string|number; manutencaoPorHora: string|number; consumiveisPorHora: string|number; infraestruturaPorHora: string|number }) {
  const base = D(input.custoAquisicao).add(input.frete).add(input.instalacao).add(input.acessoriosCapitalizados).sub(input.valorResidual);
  return base.div(input.vidaUtilHoras).add(input.manutencaoPorHora).add(input.consumiveisPorHora).add(input.infraestruturaPorHora);
}

export function machineCost(seconds: string|number, hourlySnapshot: string|number|Decimal) {
  return D(seconds).div(3600).mul(hourlySnapshot);
}

export function energyCost(input: { potenciaMediaW: string|number; horasImpressao: string|number; potenciaAquecimentoW?: string|number; horasAquecimento?: string|number; potenciaSecadorW?: string|number; horasSecagem?: string|number; tarifaKwhSnapshot: string|number }) {
  const print = D(input.potenciaMediaW).mul(input.horasImpressao).div(1000);
  const heat = D(input.potenciaAquecimentoW ?? 0).mul(input.horasAquecimento ?? 0).div(1000);
  const dry = D(input.potenciaSecadorW ?? 0).mul(input.horasSecagem ?? 0).div(1000);
  return print.add(heat).add(dry).mul(input.tarifaKwhSnapshot);
}

export function laborCost(activities: Array<{ minutos: string|number; custoHoraSnapshot: string|number }>) {
  return activities.reduce((acc, a) => acc.add(D(a.minutos).div(60).mul(a.custoHoraSnapshot)), D(0));
}

export function failureReserve(probability: string|number, failedAttemptCost: string|number) {
  const p = D(probability);
  if (p.toNumber() < 0 || p.toNumber() >= 1) throw new Error("Probabilidade de falha deve ser >= 0 e < 1");
  return p.div(D(1).sub(p)).mul(failedAttemptCost);
}

export function price(input: { custoOperacional: string|number|Decimal; tributosVenda: string|number; taxaPagamento: string|number; comissao?: string|number; royalty?: string|number; outrasTaxas?: string|number; margemLiquidaAlvo: string|number; margemMinima: string|number; pedidoMinimo?: string|number; precoMinimoConfigurado?: string|number; precoTabela?: string|number; quantidade: string|number }) {
  const taxas = D(input.tributosVenda).add(input.taxaPagamento).add(input.comissao ?? 0).add(input.royalty ?? 0).add(input.outrasTaxas ?? 0);
  const denominador = D(1).sub(taxas).sub(input.margemLiquidaAlvo);
  if (!denominador.gt(0)) throw new Error("Denominador de preço inválido");
  const custo = D(input.custoOperacional);
  const precoBase = custo.div(denominador);
  const denomLimite = D(1).sub(taxas).sub(input.margemMinima);
  if (!denomLimite.gt(0)) throw new Error("Denominador de preço limite inválido");
  const precoLimite = custo.div(denomLimite);
  let sugerido = precoBase;
  if (D(input.pedidoMinimo ?? 0).gt(sugerido)) sugerido = D(input.pedidoMinimo ?? 0);
  if (D(input.precoMinimoConfigurado ?? 0).gt(sugerido)) sugerido = D(input.precoMinimoConfigurado ?? 0);
  const comercial = sugerido.round(2);
  const lucro = comercial.sub(custo).sub(comercial.mul(taxas));
  return { taxaVariavelTotal: taxas, denominador, precoBase, precoLimite, precoSugerido: sugerido, precoComercial: comercial, lucroLiquido: lucro, margemLiquida: lucro.div(comercial), markup: comercial.div(custo), valorUnitario: comercial.div(input.quantidade), descontoMaximo: input.precoTabela ? D(1).sub(precoLimite.div(input.precoTabela)) : D(0) };
}

export function operationalCost(input: { material: string|number; maquina: string|number; energia: string|number; maoDeObra: string|number; acabamento?: string|number; embalagem?: string|number; terceiros?: string|number; entregaDireta?: string|number; reservaFalha?: string|number; indiretosRateados?: string|number; custoFixoPedido?: string|number }) {
  return D(input.material).add(input.maquina).add(input.energia).add(input.maoDeObra).add(input.acabamento ?? 0).add(input.embalagem ?? 0).add(input.terceiros ?? 0).add(input.entregaDireta ?? 0).add(input.reservaFalha ?? 0).add(input.indiretosRateados ?? 0).add(input.custoFixoPedido ?? 0);
}
