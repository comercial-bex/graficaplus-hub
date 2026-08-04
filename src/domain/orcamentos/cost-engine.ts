/**
 * Motor de custo 2D (gráfica rápida / comunicação visual).
 *
 * Espelha a lógica do motor 3D (src/domain/impressao3d/cost-engine.ts), mas
 * organizada nos três blocos que o orçamento precisa mostrar ao vendedor:
 *   Materiais  → consumo x custo unitário, considerando perda/refile
 *   Processos  → horas de máquina x custo/hora da máquina (+ setup e energia)
 *   Mão de obra→ horas x custo/hora do perfil (+ encargos)
 *
 * Fechamento: Custo operacional + Markup = Preço.
 */

export type LinhaMaterial = {
  descricao: string;
  quantidade: number;
  unidade?: string;
  custoUnitario: number;
  /** % de perda esperada (0.1 = 10% de refile/sobra) */
  perdaPct?: number;
  markupPct?: number;
};

export type LinhaProcesso = {
  descricao: string;
  horas: number;
  custoHora: number;
  setupMin?: number;
  potenciaKw?: number;
  tarifaKwh?: number;
  markupPct?: number;
};

export type LinhaMaoDeObra = {
  descricao: string;
  horas: number;
  custoHora: number;
  /** % de encargos sobre o custo/hora (0.8 = 80%) */
  encargosPct?: number;
  markupPct?: number;
};

export type EntradaCalculo = {
  quantidade?: number;
  materiais: LinhaMaterial[];
  processos: LinhaProcesso[];
  maoDeObra: LinhaMaoDeObra[];
  /** custos que não entram nos três blocos (terceiros, frete, embalagem) */
  outrosCustos?: number;
  /** despesas variáveis sobre a venda: impostos, taxa de cartão, comissão */
  taxasVendaPct?: number;
  /** markup padrão aplicado a linhas sem markup próprio (0.3 = 30%) */
  markupPadraoPct?: number;
  descontoPct?: number;
};

export type LinhaCalculada = {
  descricao: string;
  detalhe: string;
  custo: number;
  markupPct: number;
  preco: number;
  lucro: number;
  lucroPct: number;
};

export type ResultadoCalculo = {
  materiais: LinhaCalculada[];
  processos: LinhaCalculada[];
  maoDeObra: LinhaCalculada[];
  outrosCustos: number;
  custoMateriais: number;
  custoProcessos: number;
  custoMaoDeObra: number;
  custoTotal: number;
  precoBruto: number;
  desconto: number;
  precoFinal: number;
  taxasVenda: number;
  lucro: number;
  margemPct: number;
  markupEfetivoPct: number;
  precoUnitario: number;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const safe = (n: number | undefined | null) => (Number.isFinite(n as number) ? (n as number) : 0);

function montar(
  descricao: string,
  detalhe: string,
  custo: number,
  markupPct: number,
): LinhaCalculada {
  const preco = custo * (1 + markupPct);
  const lucro = preco - custo;
  return {
    descricao,
    detalhe,
    custo: round2(custo),
    markupPct,
    preco: round2(preco),
    lucro: round2(lucro),
    lucroPct: preco > 0 ? lucro / preco : 0,
  };
}

export function custoMaterial(linha: LinhaMaterial) {
  const perda = safe(linha.perdaPct);
  if (perda < 0 || perda >= 1) throw new Error("Perda deve ser >= 0 e < 100%");
  const quantidadeReal = safe(linha.quantidade) / (1 - perda);
  return quantidadeReal * safe(linha.custoUnitario);
}

export function custoProcesso(linha: LinhaProcesso) {
  const horas = safe(linha.horas) + safe(linha.setupMin) / 60;
  const maquina = horas * safe(linha.custoHora);
  const energia = horas * safe(linha.potenciaKw) * safe(linha.tarifaKwh);
  return maquina + energia;
}

export function custoMaoDeObra(linha: LinhaMaoDeObra) {
  return safe(linha.horas) * safe(linha.custoHora) * (1 + safe(linha.encargosPct));
}

export function calcularOrcamento(entrada: EntradaCalculo): ResultadoCalculo {
  const markupPadrao = safe(entrada.markupPadraoPct);
  const quantidade = entrada.quantidade && entrada.quantidade > 0 ? entrada.quantidade : 1;

  const materiais = entrada.materiais.map((m) => {
    const perda = safe(m.perdaPct);
    const detalhe =
      `${m.quantidade} ${m.unidade ?? "un"} × ${m.custoUnitario.toFixed(2)}` +
      (perda > 0 ? ` (+${(perda * 100).toFixed(0)}% perda)` : "");
    return montar(m.descricao, detalhe, custoMaterial(m), m.markupPct ?? markupPadrao);
  });

  const processos = entrada.processos.map((p) => {
    const horas = safe(p.horas) + safe(p.setupMin) / 60;
    const detalhe = `${horas.toFixed(2)} h × ${p.custoHora.toFixed(2)}/h`;
    return montar(p.descricao, detalhe, custoProcesso(p), p.markupPct ?? markupPadrao);
  });

  const maoDeObra = entrada.maoDeObra.map((mo) => {
    const encargos = safe(mo.encargosPct);
    const detalhe =
      `${mo.horas} h × ${mo.custoHora.toFixed(2)}/h` +
      (encargos > 0 ? ` (+${(encargos * 100).toFixed(0)}% encargos)` : "");
    return montar(mo.descricao, detalhe, custoMaoDeObra(mo), mo.markupPct ?? markupPadrao);
  });

  const soma = (linhas: LinhaCalculada[], campo: "custo" | "preco") =>
    linhas.reduce((acc, l) => acc + l[campo], 0);

  const custoMateriais = soma(materiais, "custo");
  const custoProcessos = soma(processos, "custo");
  const custoMO = soma(maoDeObra, "custo");
  const outros = safe(entrada.outrosCustos);
  const custoTotal = custoMateriais + custoProcessos + custoMO + outros;

  const precoBruto =
    soma(materiais, "preco") +
    soma(processos, "preco") +
    soma(maoDeObra, "preco") +
    outros * (1 + markupPadrao);

  const descontoPct = safe(entrada.descontoPct);
  const desconto = precoBruto * descontoPct;
  const precoFinal = precoBruto - desconto;
  const taxasVenda = precoFinal * safe(entrada.taxasVendaPct);
  const lucro = precoFinal - custoTotal - taxasVenda;

  return {
    materiais,
    processos,
    maoDeObra,
    outrosCustos: round2(outros),
    custoMateriais: round2(custoMateriais),
    custoProcessos: round2(custoProcessos),
    custoMaoDeObra: round2(custoMO),
    custoTotal: round2(custoTotal),
    precoBruto: round2(precoBruto),
    desconto: round2(desconto),
    precoFinal: round2(precoFinal),
    taxasVenda: round2(taxasVenda),
    lucro: round2(lucro),
    margemPct: precoFinal > 0 ? lucro / precoFinal : 0,
    markupEfetivoPct: custoTotal > 0 ? precoFinal / custoTotal - 1 : 0,
    precoUnitario: round2(precoFinal / quantidade),
  };
}

/** Preço necessário para atingir uma margem líquida alvo. */
export function precoParaMargem(custoTotal: number, margemAlvo: number, taxasVendaPct = 0) {
  const denominador = 1 - margemAlvo - taxasVendaPct;
  if (denominador <= 0) throw new Error("Margem alvo somada às taxas inviabiliza o preço");
  return round2(custoTotal / denominador);
}

/** Percentual de desperdício a partir do planejado x perdido. */
export function percentualDesperdicio(planejado: number, perdido: number) {
  if (planejado <= 0) return 0;
  return perdido / planejado;
}
