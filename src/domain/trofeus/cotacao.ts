/**
 * MONTA A COTAÇÃO DO TROFÉU a partir do que o banco guarda (22/11/2026). Função pura: sem banco, sem React, sem
 * chave de serviço. Quem lê as tabelas é o servidor (`src/lib/api/trofeus.functions.ts`); aqui as linhas já chegaram.
 *
 * Esta peça faz três coisas que `conta.ts` (a matemática) não faz:
 *   1. traduz as linhas do cadastro nas taxas da conta, pelas MESMAS fontes do `custo_cheio_do_produto`
 *      (custos_tabela, custos_mao_de_obra, maquinas e `COALESCE(custo_medio, custo_unitario)` dos materiais);
 *   2. recusa cadastro incompleto com frase em português ("Falta o custo da hora do laser..."), nunca preço com
 *      número de fábrica;
 *   3. separa o que o VENDEDOR vê (só preço e avisos) do que quem tem `financeiro.read` vê (custo, multiplicador,
 *      margem). A resposta pública é montada por lista explícita de campos, como `cotacaoPublica` do 3D: um campo
 *      novo na conta nunca vaza por acaso.
 */
import {
  calcularTrofeu,
  ErroDoTrofeu,
  precoDaArte,
  type Decoracao,
  type EntradaDaArte,
  type FaixaDeQuantidade,
  type LinhaDaArte,
  type LinhaDoTrofeu,
  type ModeloDeTrofeu,
  type RegrasDaArte,
  type RegrasDoTrofeu,
  type ResultadoDoTrofeu,
  type TaxasDoTrofeu,
  type TipoDeArte,
} from "./conta";

// ---------------------------------------------------------------------------------------------------------
// As linhas do banco (tipos mínimos: só o que esta peça lê). Numeric do Postgres chega como número ou texto.
// ---------------------------------------------------------------------------------------------------------

type Valor = unknown;

export type LinhaDasRegras = {
  faixas: Valor;
  piso_do_multiplicador: Valor;
  multiplicador_de_urgencia: Valor;
  altura_minima_m: Valor;
  altura_maxima_m: Valor;
  espessura_maxima_de_corte_mm: Valor;
  tinta_ml_m2: Valor;
  cola_ml_por_juncao: Valor;
  cola_ml_por_frasco: Valor;
  gravacao_min_por_m2: Valor;
  preparo_do_laser_min: Valor;
  velocidade_de_corte: Valor;
  arte_horas: Valor;
  arte_multiplicador: Valor;
  arte_arredonda_na_dezena: Valor;
  arte_desconto_a_partir_de: Valor;
  arte_desconto_pct: Valor;
  arte_alteracao_extra: Valor;
  arte_nome_individual: Valor;
  provisorios: Valor;
  material_vinil_id: Valor;
  material_laminacao_id: Valor;
  material_tinta_id: Valor;
  material_cola_id: Valor;
};

export type LinhaDoModelo = {
  id: string;
  nome: string;
  descricao?: string | null;
  linha: Valor;
  altura_referencia_m: Valor;
  minutos_de_mao_de_obra: Valor;
  multiplicador_base: Valor;
  ativo: Valor;
  provisorio: Valor;
};

export type LinhaDaPeca = {
  ordem: Valor;
  nome: string;
  material_id: string;
  espessura_mm: Valor;
  largura_m: Valor;
  altura_m: Valor;
  quantidade: Valor;
  fator_de_forma: Valor;
  decoracao: Valor;
};

export type LinhaDeMaterial = {
  id: string;
  nome: string;
  unidade: string | null;
  custo_unitario: Valor;
  custo_medio: Valor;
  /** Saldo em estoque, na unidade do material (m² nas chapas). Só gera AVISO: nunca bloqueia o orçamento. */
  estoque?: Valor;
};

export type LinhaDeCusto = { codigo: string; valor: Valor };

export type LinhaDeMaoDeObra = { funcao?: string | null; setor?: string | null; custo_hora: Valor; encargos_pct: Valor };

export type LinhaDeMaquina = {
  nome: string;
  tipo: string;
  setor?: string | null;
  custo_hora: Valor;
  potencia_kw: Valor;
  velocidade_m2_h: Valor;
  velocidade_calculo_m2_h: Valor;
};

/** Tudo o que o servidor leu, sem tratar. */
export type BaseDaCotacao = {
  regras: LinhaDasRegras;
  modelo: LinhaDoModelo;
  pecas: LinhaDaPeca[];
  materiais: LinhaDeMaterial[];
  custos: LinhaDeCusto[];
  maoDeObra: LinhaDeMaoDeObra[];
  maquinas: LinhaDeMaquina[];
};

export type EntradaDaCotacao = {
  alturaCm: number;
  quantidade: number;
  urgente: boolean;
  arte: { tipo: TipoDeArte; alteracoesExtras: number; nomesIndividuais: number } | null;
  /** Só quem vê custo manda; o servidor recusa de quem não vê, e o abaixo do piso só de gestor ou admin. */
  multiplicadorManual?: number | null;
};

// ---------------------------------------------------------------------------------------------------------
// Frases de cadastro incompleto
// ---------------------------------------------------------------------------------------------------------

const AVISE = "Avise a gerência.";

function numero(v: Valor, onde: string): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) throw new ErroDoTrofeu(`${onde}. ${AVISE}`);
  const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new ErroDoTrofeu(`${onde}. ${AVISE}`);
  return n;
}

function positivo(v: Valor, onde: string): number {
  const n = numero(v, onde);
  if (!(n > 0)) throw new ErroDoTrofeu(`${onde}. ${AVISE}`);
  return n;
}

function faixasDe(v: Valor): FaixaDeQuantidade[] {
  if (!Array.isArray(v) || v.length === 0) throw new ErroDoTrofeu(`Faltam as faixas de quantidade do troféu. ${AVISE}`);
  return v.map((f) => {
    const x = (f ?? {}) as { de?: Valor; fator?: Valor };
    return {
      de: positivo(x.de, "Uma faixa de quantidade do troféu está incompleta"),
      fator: positivo(x.fator, "Uma faixa de quantidade do troféu está incompleta"),
    };
  });
}

function velocidadesDe(v: Valor): Record<string, number> {
  if (v == null || typeof v !== "object" || Array.isArray(v)) throw new ErroDoTrofeu(`Faltam as velocidades de corte do laser. ${AVISE}`);
  const saida: Record<string, number> = {};
  for (const [mm, vel] of Object.entries(v as Record<string, Valor>)) {
    saida[mm] = positivo(vel, `A velocidade de corte de ${mm} mm está incompleta`);
  }
  return saida;
}

const LINHAS: readonly LinhaDoTrofeu[] = ["economico", "padrao", "premium"];
const DECORACOES: readonly Decoracao[] = ["nenhuma", "vinil_laminado", "gravacao_laser"];

// ---------------------------------------------------------------------------------------------------------
// As taxas, pelas mesmas fontes do custo cheio do produto
// ---------------------------------------------------------------------------------------------------------

/** Custo por unidade do material, como o produto lê: `COALESCE(custo_medio, custo_unitario)`. */
function custoDoMaterial(m: LinhaDeMaterial | undefined): number | null {
  if (!m) return null;
  const medio = m.custo_medio == null ? null : Number(m.custo_medio);
  const unit = m.custo_unitario == null ? null : Number(m.custo_unitario);
  const c = medio != null && Number.isFinite(medio) ? medio : unit;
  return c != null && Number.isFinite(c) ? c : null;
}

export type TaxasMontadas = {
  taxas: TaxasDoTrofeu;
  regras: RegrasDoTrofeu;
  regrasDaArte: RegrasDaArte;
  modelo: ModeloDeTrofeu;
  /** O que a plotter ainda não tem de custo cadastrado (manutenção, limpeza e cabeçote). */
  plotterSemExtras: boolean;
};

export function montarTaxas(base: BaseDaCotacao): TaxasMontadas {
  const { regras: r, modelo: m } = base;
  const custo = new Map(base.custos.map((c) => [c.codigo, c.valor]));
  const doCusto = (codigo: string, onde: string) => positivo(custo.get(codigo), onde);

  const tarifa = doCusto("energia_tarifa_kwh", "Falta a tarifa de energia (kWh) nos custos fixos");
  const lasers = base.maquinas.filter((x) => x.tipo === "laser_co2");
  if (lasers.length !== 1) {
    throw new ErroDoTrofeu(
      lasers.length === 0
        ? `Não há laser CO2 ativo no cadastro de máquinas. ${AVISE}`
        : `Há mais de um laser CO2 ativo no cadastro: o troféu não sabe qual usar. ${AVISE}`,
    );
  }
  const laser = lasers[0];
  const laserHora = positivo(laser.custo_hora, `Falta o custo por hora do laser (${laser.nome})`) +
    numero(laser.potencia_kw ?? 0, `A potência do laser (${laser.nome}) é inválida`) * tarifa;

  const plotters = base.maquinas.filter((x) => x.tipo === "plotter_impressao");
  if (plotters.length !== 1) {
    throw new ErroDoTrofeu(
      plotters.length === 0
        ? `Não há plotter de impressão ativa no cadastro de máquinas. ${AVISE}`
        : `Há mais de uma plotter de impressão ativa: o troféu não sabe qual usar. ${AVISE}`,
    );
  }
  const plotter = plotters[0];
  const velocidadePlotter = positivo(
    Number(plotter.velocidade_calculo_m2_h ?? 0) > 0 ? plotter.velocidade_calculo_m2_h : plotter.velocidade_m2_h,
    `Falta a velocidade da plotter (${plotter.nome})`,
  );
  const plotterM2 =
    positivo(plotter.custo_hora, `Falta o custo por hora da plotter (${plotter.nome})`) / velocidadePlotter +
    (numero(plotter.potencia_kw ?? 0, `A potência da plotter (${plotter.nome}) é inválida`) * tarifa) / velocidadePlotter;
  const plotterSemExtras = ["plotter_manutencao_mensal", "plotter_limpeza_mensal", "plotter_cabecote_custo", "plotter_cabecote_vida_m2"].some(
    (c) => custo.get(c) == null,
  );

  // Mão de obra: a função do mesmo setor do laser, como o produto escolhe; senão a de maior custo por hora.
  const funcoes = [...base.maoDeObra].sort(
    (a, b) =>
      Number(b.setor === laser.setor) - Number(a.setor === laser.setor) || Number(b.custo_hora ?? 0) - Number(a.custo_hora ?? 0),
  );
  if (funcoes.length === 0) throw new ErroDoTrofeu(`Não há custo de mão de obra cadastrado. ${AVISE}`);
  const moHora = positivo(funcoes[0].custo_hora, "Falta o custo por hora da mão de obra") * (1 + numero(funcoes[0].encargos_pct ?? 0, "Os encargos da mão de obra são inválidos"));

  const materiais = new Map(base.materiais.map((x) => [x.id, x]));
  const custoPorId = (id: Valor, rotulo: string): number => {
    const c = custoDoMaterial(typeof id === "string" ? materiais.get(id) : undefined);
    if (c == null || !(c > 0)) throw new ErroDoTrofeu(`${rotulo} está sem custo no cadastro de materiais. ${AVISE}`);
    return c;
  };
  const colaMl = positivo(r.cola_ml_por_frasco, "Falta quantos ml rende um frasco de cola");
  const tintaDoCadastro = custo.get("tinta_consumo_ml_m2");

  const custoM2PorMaterial: Record<string, number | null> = {};
  for (const p of base.pecas) {
    const mat = materiais.get(p.material_id);
    custoM2PorMaterial[p.material_id] = mat && mat.unidade === "m²" ? custoDoMaterial(mat) : null;
  }

  const taxas: TaxasDoTrofeu = {
    custoM2PorMaterial,
    pctPerdaMaterial: numero(custo.get("pct_perda_material"), "Falta a perda de material nos custos fixos"),
    pctFalhaProducao: numero(custo.get("pct_falha_producao"), "Falta a falha de produção nos custos fixos"),
    vinilM2: custoPorId(r.material_vinil_id, "O vinil da decoração"),
    laminacaoM2: custoPorId(r.material_laminacao_id, "A laminação da decoração"),
    // O consumo medido (custos fixos) vence a estimativa das regras assim que alguém o preencher.
    tintaMlM2: Number(tintaDoCadastro) > 0 ? Number(tintaDoCadastro) : numero(r.tinta_ml_m2, "Falta o consumo de tinta do troféu"),
    custoMlTinta: custoPorId(r.material_tinta_id, "A tinta"),
    plotterM2,
    colaMlPorJuncao: numero(r.cola_ml_por_juncao, "Falta o consumo de cola do troféu"),
    custoMlCola: custoPorId(r.material_cola_id, "A cola") / colaMl,
    laserHora,
    velocidadeDeCorteMPorMin: velocidadesDe(r.velocidade_de_corte),
    gravacaoMinPorM2: numero(r.gravacao_min_por_m2, "Falta o tempo de gravação do troféu"),
    preparoDoLaserMin: numero(r.preparo_do_laser_min, "Falta o tempo de preparo do laser"),
    moHora,
    adminHora: doCusto("custo_admin_hora", "Falta o custo administrativo por hora nos custos fixos"),
    ocupacaoAlvoPct: doCusto("ocupacao_alvo_pct", "Falta a ocupação alvo nos custos fixos"),
    impostoPct: numero(custo.get("impostos_venda"), "Faltam os impostos sobre a venda nos custos fixos"),
    cartaoPct: numero(custo.get("taxa_cartao"), "Falta a taxa de cartão nos custos fixos"),
  };

  const regras: RegrasDoTrofeu = {
    faixas: faixasDe(r.faixas),
    pisoDoMultiplicador: positivo(r.piso_do_multiplicador, "Falta o piso do multiplicador do troféu"),
    multiplicadorDeUrgencia: positivo(r.multiplicador_de_urgencia, "Falta o multiplicador de urgência do troféu"),
    alturaMinimaM: positivo(r.altura_minima_m, "Falta a altura mínima do troféu"),
    alturaMaximaM: positivo(r.altura_maxima_m, "Falta a altura máxima do troféu"),
    espessuraMaximaDeCorteMm: positivo(r.espessura_maxima_de_corte_mm, "Falta a espessura máxima de corte do laser"),
  };

  const regrasDaArte: RegrasDaArte = {
    horasDaCriacaoExclusiva: numero(r.arte_horas, "Faltam as horas da arte do troféu"),
    multiplicador: positivo(r.arte_multiplicador, "Falta o multiplicador da arte do troféu"),
    arredondarNaDezena: r.arte_arredonda_na_dezena === true,
    descontoAPartirDe: numero(r.arte_desconto_a_partir_de, "Falta a quantidade do desconto da arte"),
    descontoPct: numero(r.arte_desconto_pct, "Falta o desconto da arte"),
    alteracaoExtra: numero(r.arte_alteracao_extra, "Falta o valor da alteração extra da arte"),
    nomeIndividualPorPeca: numero(r.arte_nome_individual, "Falta o valor do nome individual"),
  };

  const linha = LINHAS.find((l) => l === m.linha);
  if (!linha) throw new ErroDoTrofeu(`O modelo "${m.nome}" está sem linha (econômico, padrão ou premium). ${AVISE}`);
  const modelo: ModeloDeTrofeu = {
    id: m.id,
    nome: m.nome,
    linha,
    alturaDeReferenciaM: positivo(m.altura_referencia_m, `Falta a altura de referência do modelo "${m.nome}"`),
    minutosDeMaoDeObra: numero(m.minutos_de_mao_de_obra, `Faltam os minutos de mão de obra do modelo "${m.nome}"`),
    multiplicadorBase: positivo(m.multiplicador_base, `Falta o multiplicador do modelo "${m.nome}"`),
    pecas: [...base.pecas]
      .sort((a, b) => Number(a.ordem) - Number(b.ordem))
      .map((p) => {
        const decoracao = DECORACOES.find((d) => d === p.decoracao);
        if (!decoracao) throw new ErroDoTrofeu(`A peça "${p.nome}" está com uma decoração que o troféu não conhece. ${AVISE}`);
        const onde = `A peça "${p.nome}" está incompleta`;
        return {
          nome: p.nome,
          materialId: p.material_id,
          espessuraMm: positivo(p.espessura_mm, onde),
          larguraM: positivo(p.largura_m, onde),
          alturaM: positivo(p.altura_m, onde),
          quantidade: positivo(p.quantidade, onde),
          fatorDeForma: positivo(p.fator_de_forma, onde),
          decoracao,
        };
      }),
  };

  return { taxas, regras, regrasDaArte, modelo, plotterSemExtras };
}

// ---------------------------------------------------------------------------------------------------------
// Os avisos: o que ainda é estimativa, em frase (sem número de custo)
// ---------------------------------------------------------------------------------------------------------

const FRASES_DOS_PROVISORIOS: Record<string, string> = {
  tinta_ml_m2: "O consumo de tinta ainda é uma estimativa.",
  cola_ml_por_juncao: "O consumo de cola ainda é uma estimativa.",
  gravacao_min_por_m2: "O tempo de gravação a laser foi pesquisado, ainda não medido na máquina.",
  preparo_do_laser_min: "O tempo de preparo do laser ainda é uma estimativa.",
  velocidade_de_corte: "A velocidade de corte do laser foi pesquisada, ainda não medida na máquina.",
  arte_horas: "As horas de criação da arte ainda são uma estimativa.",
  arte_desconto: "O desconto da arte por quantidade ainda é uma estimativa.",
  medidas_dos_modelos: "As medidas das peças vêm das imagens do modelo, ainda não foram medidas numa produção.",
  espelhado_dourado_sem_nota: "O custo do acrílico espelhado dourado é o valor informado pelo dono, ainda sem nota de compra.",
  dtf_uv_compra_externa: "Decoração em DTF UV não entra neste orçamento: sai por compra externa.",
};

/** Só vale falar do dourado quando o modelo usa dourado. */
const SO_COM_DOURADO = "espelhado_dourado_sem_nota";
/** Só vale falar da arte quando o orçamento pede arte. */
const SO_COM_ARTE = new Set(["arte_horas", "arte_desconto"]);

export function avisosDaCotacao(
  base: BaseDaCotacao,
  opcoes: { pediuArte: boolean; plotterSemExtras: boolean; usaDecoracaoImpressa: boolean },
): string[] {
  const nomes = Array.isArray(base.regras.provisorios) ? (base.regras.provisorios as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const materiaisDoModelo = new Set(base.pecas.map((p) => p.material_id));
  const usaDourado = base.materiais.some((m) => materiaisDoModelo.has(m.id) && /dourad/i.test(m.nome));
  const avisos: string[] = [];
  for (const nome of nomes) {
    if (nome === SO_COM_DOURADO && !usaDourado) continue;
    if (SO_COM_ARTE.has(nome) && !opcoes.pediuArte) continue;
    avisos.push(FRASES_DOS_PROVISORIOS[nome] ?? "Há um parâmetro do troféu ainda em estimativa.");
  }
  if (base.modelo.provisorio === true && !nomes.includes("medidas_dos_modelos")) {
    avisos.push(FRASES_DOS_PROVISORIOS.medidas_dos_modelos);
  }
  if (opcoes.plotterSemExtras && opcoes.usaDecoracaoImpressa) {
    avisos.push("A manutenção, a limpeza e o cabeçote da plotter ainda não foram informados: a decoração impressa pode estar um pouco mais barata do que é.");
  }
  return avisos;
}

// ---------------------------------------------------------------------------------------------------------
// O estoque só AVISA: o dono decidiu (22/11/2026) que dá para orçar sem ter a chapa; o gestor repõe depois
// ---------------------------------------------------------------------------------------------------------

/** Metros quadrados de cada material que o pedido usa, já com a sobra de corte e a falha. */
export function necessidadePorMaterial(
  modelo: ModeloDeTrofeu,
  alturaM: number,
  quantidade: number,
  pctPerdaEFalha: number,
): Map<string, number> {
  const f = alturaM / modelo.alturaDeReferenciaM;
  const sobra = 1 - Math.min(Math.max(pctPerdaEFalha, 0), 90) / 100;
  const total = new Map<string, number>();
  for (const p of modelo.pecas) {
    const area = p.larguraM * f * (p.alturaM * f) * p.quantidade * quantidade;
    total.set(p.materialId, (total.get(p.materialId) ?? 0) + area / sobra);
  }
  return total;
}

export function avisosDeEstoque(base: BaseDaCotacao, necessidade: Map<string, number>): string[] {
  const avisos: string[] = [];
  for (const [id, precisa] of necessidade) {
    const mat = base.materiais.find((m) => m.id === id);
    if (!mat || mat.unidade !== "m²" || mat.estoque == null) continue;
    const saldo = Number(mat.estoque);
    if (!Number.isFinite(saldo) || saldo + 1e-9 >= precisa) continue;
    avisos.push(`Estoque de ${mat.nome} abaixo do necessário para este pedido. O orçamento sai normalmente; o gestor precisa repor antes de produzir.`);
  }
  return avisos;
}

// ---------------------------------------------------------------------------------------------------------
// A cotação
// ---------------------------------------------------------------------------------------------------------

export type CotacaoDoTrofeu = {
  entrada: EntradaDaCotacao;
  modelo: ModeloDeTrofeu;
  /** O piso do multiplicador da casa (×2,2), para o simulador mostrar de onde vem o "abaixo do piso". */
  pisoDoMultiplicador: number;
  resultado: ResultadoDoTrofeu;
  arte: { linhas: LinhaDaArte[]; total: number } | null;
  avisos: string[];
};

/** Faz a conta. Lança ErroDoTrofeu (frase em português) quando o cadastro está incompleto ou a entrada não vale. */
export function cotarTrofeuComABase(base: BaseDaCotacao, entrada: EntradaDaCotacao): CotacaoDoTrofeu {
  const { taxas, regras, regrasDaArte, modelo, plotterSemExtras } = montarTaxas(base);
  // Em milímetros inteiros: 18 cm vira 0,18 m sem a sujeira de ponto flutuante.
  const alturaM = Math.round(entrada.alturaCm * 10) / 1000;
  const resultado = calcularTrofeu(
    { modelo, alturaM, quantidade: entrada.quantidade, urgente: entrada.urgente, multiplicadorManual: entrada.multiplicadorManual ?? null },
    taxas,
    regras,
  );

  let arte: CotacaoDoTrofeu["arte"] = null;
  if (entrada.arte) {
    const pedido: EntradaDaArte = {
      tipo: entrada.arte.tipo,
      quantidadeDeTrofeus: entrada.quantidade,
      alteracoesExtras: entrada.arte.alteracoesExtras,
      nomesIndividuais: entrada.arte.nomesIndividuais,
    };
    arte = precoDaArte(pedido, taxas, regrasDaArte);
  }

  const avisos = [
    ...avisosDaCotacao(base, {
      pediuArte: entrada.arte != null,
      plotterSemExtras,
      usaDecoracaoImpressa: modelo.pecas.some((p) => p.decoracao === "vinil_laminado"),
    }),
    ...avisosDeEstoque(base, necessidadePorMaterial(modelo, alturaM, entrada.quantidade, taxas.pctPerdaMaterial + taxas.pctFalhaProducao)),
  ];
  return { entrada, modelo, pisoDoMultiplicador: regras.pisoDoMultiplicador, resultado, arte, avisos };
}

// ---------------------------------------------------------------------------------------------------------
// As duas respostas: a do vendedor e a de quem vê custo
// ---------------------------------------------------------------------------------------------------------

/** A linha da arte que o vendedor vê: descrição e valor, nunca o custo. */
export type LinhaPublicaDaArte = { descricao: string; valor: number };

export type CotacaoPublicaDoTrofeu = {
  modelo: { id: string; nome: string };
  alturaCm: number;
  quantidade: number;
  urgente: boolean;
  precoUnitario: number;
  precoTotal: number;
  arte: { linhas: LinhaPublicaDaArte[]; total: number } | null;
  totalGeral: number;
  avisos: string[];
};

export type CotacaoComCustoDoTrofeu = CotacaoPublicaDoTrofeu & {
  custo: ResultadoDoTrofeu["custo"];
  custoCheio: number;
  custoDeProducao: number;
  multiplicador: number;
  /** O multiplicador veio da mão de quem simulou, e não da escada de quantidade. */
  multiplicadorManual: boolean;
  /** O multiplicador aplicado ficou abaixo do piso da casa: só gestor ou admin dá o aval. */
  abaixoDoPiso: boolean;
  pisoDoMultiplicador: number;
  faixaDe: number;
  precoCalculado: number;
  margemLiquidaPct: number;
  areaUtilM2: number;
  corteM: number;
  pecas: number;
  minutosDeLaser: number;
  minutosDeMaoDeObra: number;
};

const reais = (n: number) => Math.round(n * 100) / 100;

/** O que o vendedor recebe: preço, a arte, o total e os avisos. NENHUM custo, multiplicador ou margem. */
export function cotacaoPublica(c: CotacaoDoTrofeu): CotacaoPublicaDoTrofeu {
  const arteTotal = c.arte?.total ?? 0;
  return {
    modelo: { id: c.modelo.id, nome: c.modelo.nome },
    alturaCm: c.entrada.alturaCm,
    quantidade: c.entrada.quantidade,
    urgente: c.entrada.urgente,
    precoUnitario: c.resultado.precoUnitario,
    precoTotal: c.resultado.precoTotal,
    arte: c.arte ? { linhas: c.arte.linhas.map((l) => ({ descricao: l.descricao, valor: l.valor })), total: c.arte.total } : null,
    totalGeral: reais(c.resultado.precoTotal + arteTotal),
    avisos: [...c.avisos],
  };
}

/** Quem tem `financeiro.read` recebe o mesmo e a decomposição. */
export function cotacaoComCusto(c: CotacaoDoTrofeu): CotacaoComCustoDoTrofeu {
  const r = c.resultado;
  return {
    ...cotacaoPublica(c),
    custo: { ...r.custo },
    custoCheio: r.custoCheio,
    custoDeProducao: r.custoDeProducao,
    multiplicador: r.multiplicador,
    multiplicadorManual: r.multiplicadorManual,
    abaixoDoPiso: r.abaixoDoPiso,
    pisoDoMultiplicador: c.pisoDoMultiplicador,
    faixaDe: r.faixaDe,
    precoCalculado: r.precoCalculado,
    margemLiquidaPct: r.margemLiquidaPct,
    areaUtilM2: r.areaUtilM2,
    corteM: r.corteM,
    pecas: r.pecas,
    minutosDeLaser: r.minutosDeLaser,
    minutosDeMaoDeObra: r.minutosDeMaoDeObra,
  };
}
