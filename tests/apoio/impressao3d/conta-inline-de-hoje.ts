/**
 * ORÁCULO: a conta da calculadora 3D como ela estava na main de 11/11/2026 (commit dcd82c90), copiada de
 * `src/components/impressao3d/calculadora-3d.tsx`, o `useMemo` das linhas 428 a 509 e a função `num` das
 * linhas 54 a 62, ANTES de a conta ser extraída para `src/domain/impressao3d/calcular-peca.ts`.
 * NÃO é código de produção e NÃO deve ser "melhorado": os testes de paridade existem para provar que o
 * módulo puro devolve, ao centavo e em todos os componentes, o mesmo que esta conta. Se um dia a regra de
 * preço mudar DE PROPÓSITO, muda-se o módulo e este arquivo juntos, com decisão do dono.
 *
 * Diferenças em relação ao texto da calculadora (as únicas, conferidas instrução por instrução):
 *   1. `num` e `contaInlineDeHoje` ganharam `export`, e a conta virou função;
 *   2. o filamento e a configuração entram como parâmetro (`custoPorGramaCalculado`, `markupAtacadoPadrao`),
 *      porque na tela eles vêm de consultas do React Query;
 *   3. o Prettier acrescentou uma vírgula final na chamada de `custoDeEmbalagemDoItem`.
 *
 * As entradas entram do jeito que a tela as guarda: TEXTO (o estado do formulário), porque é assim que a
 * conta de hoje as lê (`num(f.gramas)`, `num(f.quantidade, 1) || 1`...).
 */
import {
  materialCost,
  machineCost,
  energyCost,
  laborCost,
  operationalCost,
} from "../../../src/domain/impressao3d/cost-engine";
import { D } from "../../../src/domain/impressao3d/decimal";
import { custoDeEmbalagemDoItem } from "../../../src/domain/impressao3d/custo-administrativo";
import {
  fecharPreco,
  horasDeMaoDeObraPorPeca,
  PRECO_MINIMO_POR_PECA,
} from "../../../src/domain/impressao3d/preco";

/** `num` de calculadora-3d.tsx:54-62, igual. */
export const num = (v: string, fallback = 0) => {
  // tolera vírgula decimal (pt-BR): "6,52" -> 6.52, sem quebrar "1.375".
  let s = String(v ?? "").trim();
  if (s.includes(",")) {
    s = s.includes(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

/** Os campos de `FormState` que a conta lê (calculadora-3d.tsx:72-98). Tudo texto, como na tela. */
export type CamposDaConta = {
  quantidade: string;
  gramas: string;
  peso_suporte: string;
  peso_purga: string;
  pecas_placa: string;
  custo_hora: string;
  potencia_w: string;
  tarifa_kwh: string;
  mo_custo_hora: string;
  mo_horas: string;
  pct_acabamento: string;
  pct_falha: string;
  custo_admin: string;
  markup: string;
};

export function contaInlineDeHoje(a: {
  f: CamposDaConta;
  /** `parseTempoLivre(f.tempo) ?? 0`: minutos inteiros. */
  tempoMinutos: number;
  /** `filamento?.custo_por_grama_calculado` (o que o PostgREST devolve; nulo se o filamento não foi achado). */
  custoPorGramaCalculado: number | string | null | undefined;
  embalagemIncluida: boolean;
  /** `configPrec?.markup_atacado_padrao` (nulo se a configuração não chegou). */
  markupAtacadoPadrao: number | string | null | undefined;
}) {
  const { f, embalagemIncluida } = a;
  const tempoMinutos = a.tempoMinutos;
  const tempoHoras = tempoMinutos / 60; // calculadora-3d.tsx:426

  // ---- useMemo, calculadora-3d.tsx:428-509 ----
  const gramasModelo = num(f.gramas);
  const gramasSuporte = num(f.peso_suporte);
  const gramasPurga = num(f.peso_purga);
  const gramas = gramasModelo + gramasSuporte + gramasPurga;
  const horasTotais = tempoHoras;
  const cpg = Number(a.custoPorGramaCalculado ?? 0);
  const custoHora = num(f.custo_hora);
  const potenciaW = num(f.potencia_w);
  const qtd = num(f.quantidade, 1) || 1;
  const pecasPlaca = num(f.pecas_placa, 1) || 1;
  const placas = Math.max(1, Math.ceil(qtd / pecasPlaca));

  const materialPlaca = materialCost(D(gramas), cpg);
  const maquinaPlaca = machineCost(horasTotais * 3600, custoHora);
  const energiaPlaca = energyCost({
    potenciaMediaW: potenciaW,
    horasImpressao: horasTotais,
    tarifaKwhSnapshot: num(f.tarifa_kwh),
  });

  const material = materialPlaca.mul(placas);
  const maquina = maquinaPlaca.mul(placas);
  const energia = energiaPlaca.mul(placas);
  const acabamento = material.mul(num(f.pct_acabamento) / 100);
  const risco = material.mul(num(f.pct_falha) / 100);
  const horasMaoDeObra = horasDeMaoDeObraPorPeca(num(f.mo_horas));
  const maoDeObra = laborCost([
    { minutos: horasMaoDeObra * 60, custoHoraSnapshot: num(f.mo_custo_hora) },
  ]).mul(qtd);
  const indireto = custoDeEmbalagemDoItem({
    incluir: embalagemIncluida,
    valor: num(f.custo_admin),
  });

  const operacional = operationalCost({
    material: material.toString(),
    maquina: maquina.toString(),
    energia: energia.toString(),
    maoDeObra: maoDeObra.toString(),
    acabamento: acabamento.toString(),
    reservaFalha: risco.toString(),
    indiretosRateados: indireto.toString(),
  });
  const markup = num(f.markup, 2) || 2;
  const { preco, unitario, lucro, margem, peloMinimo } = fecharPreco(
    operacional,
    markup,
    qtd,
    PRECO_MINIMO_POR_PECA,
  );
  const markupAtacado = Number(a.markupAtacadoPadrao ?? 1.5) || 1.5;
  const equilibrio = operacional.mul(1 / 0.9);
  return {
    cpg,
    custoHora,
    material,
    maquina,
    energia,
    maoDeObra,
    acabamento,
    risco,
    indireto,
    operacional,
    preco,
    unitario,
    peloMinimo,
    horasMaoDeObra,
    lucro,
    margem,
    atacado: operacional.mul(markupAtacado),
    markupAtacado,
    equilibrio,
    qtd,
    pecasPlaca,
    placas,
    markup,
  };
}

/** Atalho: converte as entradas numéricas do corpus de ouro para o texto que a tela guardaria. */
export function camposDaTela(e: {
  quantidade: number;
  gramasModelo: number;
  pesoSuporteG: number;
  pesoPurgaG: number;
  pecasPorPlaca: number;
  custoHoraMaquina: number;
  potenciaW: number;
  tarifaKwh: number;
  moCustoHora: number;
  moHoras: number;
  pctAcabamento: number;
  pctFalha: number;
  embalagemIncluida: boolean;
  embalagemValor: number;
  markup: number;
}): CamposDaConta {
  return {
    quantidade: String(e.quantidade),
    gramas: String(e.gramasModelo),
    peso_suporte: e.pesoSuporteG > 0 ? String(e.pesoSuporteG) : "",
    peso_purga: e.pesoPurgaG > 0 ? String(e.pesoPurgaG) : "",
    pecas_placa: e.pecasPorPlaca > 1 ? String(e.pecasPorPlaca) : "",
    custo_hora: String(e.custoHoraMaquina),
    potencia_w: String(e.potenciaW),
    tarifa_kwh: String(e.tarifaKwh),
    mo_custo_hora: String(e.moCustoHora),
    mo_horas: String(e.moHoras),
    pct_acabamento: String(e.pctAcabamento),
    pct_falha: String(e.pctFalha),
    custo_admin: e.embalagemIncluida ? String(e.embalagemValor) : "0",
    markup: String(e.markup),
  };
}
