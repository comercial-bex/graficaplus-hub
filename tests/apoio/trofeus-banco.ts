import type { BaseDaCotacao, LinhaDaPeca, LinhaDeMaquina, LinhaDeMaterial } from "@/domain/trofeus/cotacao";
import type { ModeloDeTrofeu } from "@/domain/trofeus/conta";
import { ECONOMICO, MATERIAL, MODELOS, PADRAO, PREMIUM, REGRAS, REGRAS_DA_ARTE, TAXAS } from "./trofeus";

/**
 * As linhas do banco como o servidor as lê, com os números de 22/11/2026 depois dos dados do dono (o mesmo que o
 * fixture `trofeus.ts` carrega para a conta pura). `baseDoBanco(modelo)` devolve uma base NOVA a cada chamada: o teste
 * pode estragar uma linha sem contaminar os outros.
 */
export const ID = {
  vinil: "mat-vinil-branco-brilho",
  laminacao: "mat-laminacao-polimerica",
  tinta: "mat-tinta-solvente",
  cola: "mat-cola-acrilico-250ml",
} as const;

const NOME_DO_MATERIAL: Record<string, string> = {
  [MATERIAL.cristal2]: "ACRILICO CRISTAL VIRGEM 2MM",
  [MATERIAL.cristal3]: "ACRILICO CRISTAL VIRGEM 3MM",
  [MATERIAL.cristal6]: "ACRILICO CRISTAL VIRGEM 6MM",
  [MATERIAL.preto3]: "ACRILICO PRETO VIRGEM 3MM",
  [MATERIAL.dourado2]: "Acrilico esp dourado 2mm",
};

export function materiaisDoBanco(): LinhaDeMaterial[] {
  const chapas: LinhaDeMaterial[] = Object.entries(NOME_DO_MATERIAL).map(([id, nome]) => ({
    id,
    nome,
    unidade: "m²",
    custo_unitario: TAXAS.custoM2PorMaterial[id],
    custo_medio: TAXAS.custoM2PorMaterial[id],
  }));
  return [
    ...chapas,
    // O vinil tem custo médio diferente do último: o produto lê o médio (6,58), e o troféu também.
    { id: ID.vinil, nome: "Vinil adesivo branco brilho", unidade: "m²", custo_unitario: 6.42, custo_medio: TAXAS.vinilM2 },
    { id: ID.laminacao, nome: "Laminação polimérica", unidade: "m²", custo_unitario: TAXAS.laminacaoM2, custo_medio: TAXAS.laminacaoM2 },
    { id: ID.tinta, nome: "Tinta solvente (conjunto)", unidade: "ml", custo_unitario: TAXAS.custoMlTinta, custo_medio: TAXAS.custoMlTinta },
    { id: ID.cola, nome: "Cola para acrílico antimancha 250 ml", unidade: "un", custo_unitario: 71.26, custo_medio: 71.26 },
  ];
}

export function maquinasDoBanco(): LinhaDeMaquina[] {
  return [
    {
      nome: "CNC Laser 10060 — CO2 100W",
      tipo: "laser_co2",
      setor: "Acabamento",
      custo_hora: 10.79,
      potencia_kw: 1.9,
      velocidade_m2_h: 0,
      velocidade_calculo_m2_h: null,
    },
    {
      nome: "Plotter de Impressão i1600 180 — Eco",
      tipo: "plotter_impressao",
      setor: "Impressão",
      custo_hora: 14.4313,
      potencia_kw: 1.0,
      velocidade_m2_h: 14,
      velocidade_calculo_m2_h: 10,
    },
  ];
}

export function custosDoBanco() {
  return [
    { codigo: "energia_tarifa_kwh", valor: 1.1339 },
    { codigo: "custo_admin_hora", valor: TAXAS.adminHora },
    { codigo: "pct_perda_material", valor: TAXAS.pctPerdaMaterial },
    { codigo: "pct_falha_producao", valor: TAXAS.pctFalhaProducao },
    { codigo: "ocupacao_alvo_pct", valor: TAXAS.ocupacaoAlvoPct },
    { codigo: "impostos_venda", valor: TAXAS.impostoPct },
    { codigo: "taxa_cartao", valor: TAXAS.cartaoPct },
    // Ainda sem preencher no banco: o consumo de tinta cai na estimativa das regras, e a plotter ganha o aviso.
    { codigo: "tinta_consumo_ml_m2", valor: null },
    { codigo: "plotter_manutencao_mensal", valor: null },
    { codigo: "plotter_limpeza_mensal", valor: null },
    { codigo: "plotter_cabecote_custo", valor: null },
    { codigo: "plotter_cabecote_vida_m2", valor: null },
  ];
}

export function regrasDoBanco(provisorios: string[] = ["tinta_ml_m2", "gravacao_min_por_m2", "velocidade_de_corte", "arte_horas", "arte_desconto", "medidas_dos_modelos", "espelhado_dourado_sem_nota", "dtf_uv_compra_externa"]) {
  return {
    faixas: REGRAS.faixas,
    piso_do_multiplicador: REGRAS.pisoDoMultiplicador,
    multiplicador_de_urgencia: REGRAS.multiplicadorDeUrgencia,
    altura_minima_m: REGRAS.alturaMinimaM,
    altura_maxima_m: REGRAS.alturaMaximaM,
    espessura_maxima_de_corte_mm: REGRAS.espessuraMaximaDeCorteMm,
    tinta_ml_m2: TAXAS.tintaMlM2,
    cola_ml_por_juncao: TAXAS.colaMlPorJuncao,
    cola_ml_por_frasco: 250,
    gravacao_min_por_m2: TAXAS.gravacaoMinPorM2,
    preparo_do_laser_min: TAXAS.preparoDoLaserMin,
    velocidade_de_corte: { ...TAXAS.velocidadeDeCorteMPorMin },
    arte_horas: REGRAS_DA_ARTE.horasDaCriacaoExclusiva,
    arte_multiplicador: REGRAS_DA_ARTE.multiplicador,
    arte_arredonda_na_dezena: REGRAS_DA_ARTE.arredondarNaDezena,
    arte_desconto_a_partir_de: REGRAS_DA_ARTE.descontoAPartirDe,
    arte_desconto_pct: REGRAS_DA_ARTE.descontoPct,
    arte_alteracao_extra: REGRAS_DA_ARTE.alteracaoExtra,
    arte_nome_individual: REGRAS_DA_ARTE.nomeIndividualPorPeca,
    provisorios,
    material_vinil_id: ID.vinil,
    material_laminacao_id: ID.laminacao,
    material_tinta_id: ID.tinta,
    material_cola_id: ID.cola,
  };
}

export function pecasDoBanco(modelo: ModeloDeTrofeu): LinhaDaPeca[] {
  return modelo.pecas.map((p, i) => ({
    ordem: i + 1,
    nome: p.nome,
    material_id: p.materialId,
    espessura_mm: p.espessuraMm,
    largura_m: p.larguraM,
    altura_m: p.alturaM,
    quantidade: p.quantidade,
    fator_de_forma: p.fatorDeForma,
    decoracao: p.decoracao,
  }));
}

export function baseDoBanco(modelo: ModeloDeTrofeu = ECONOMICO): BaseDaCotacao {
  return {
    regras: regrasDoBanco(),
    modelo: {
      id: modelo.id,
      nome: modelo.nome,
      linha: modelo.linha,
      altura_referencia_m: modelo.alturaDeReferenciaM,
      minutos_de_mao_de_obra: modelo.minutosDeMaoDeObra,
      multiplicador_base: modelo.multiplicadorBase,
      ativo: true,
      provisorio: true,
    },
    pecas: pecasDoBanco(modelo),
    materiais: materiaisDoBanco(),
    custos: custosDoBanco(),
    maoDeObra: [
      { funcao: "Acabamento", setor: "Acabamento", custo_hora: 9.2102, encargos_pct: 0.3282 },
      { funcao: "Designer", setor: "Arte", custo_hora: 9.2102, encargos_pct: 0.3282 },
      { funcao: "Impressor", setor: "Impressão", custo_hora: 9.2102, encargos_pct: 0.3282 },
    ],
    maquinas: maquinasDoBanco(),
  };
}

export { ECONOMICO, PADRAO, PREMIUM, MODELOS };
