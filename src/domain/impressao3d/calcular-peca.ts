/**
 * A conta de preço de UMA peça 3D, sem React, sem banco e sem tela (extraída da calculadora em 11/11/2026).
 *
 * Era o `useMemo` de `components/impressao3d/calculadora-3d.tsx` (linhas 428 a 509 da main de 11/11/2026).
 * Agora há uma conta só, usada em dois lugares:
 *   * no NAVEGADOR de quem vê custo (`impressao3d.cost.read`), com as taxas lidas pelas visões `*_financeiro`;
 *   * no SERVIDOR (`lib/api/orcamento-3d.functions.ts`) para quem NÃO vê custo: as taxas são lidas com a
 *     chave de serviço, a conta roda aqui e só o PREÇO volta. O vendedor digita peso, tempo e quantidade e
 *     nunca recebe custo por grama, custo por hora, mão de obra, markup, margem nem parcela.
 *
 * O preço do vendedor NÃO muda: `tests/calcular-peca-3d.test.ts` compara esta função com a conta antiga
 * (`tests/apoio/impressao3d/conta-inline-de-hoje.ts`), ao centavo e em todos os componentes, nos 24 cálculos
 * reais gravados, em casos escritos à mão e em milhares de entradas sorteadas. `tests/cotacao-3d-no-servidor.test.ts`
 * faz o mesmo pelo servidor, com um banco falso.
 *
 * QUEM CHAMA (11/11/2026): o servidor, pela `cotarPeca3d` e pela `salvarPeca3dNoOrcamento`. A calculadora ainda
 * tem a conta escrita dentro do `useMemo` (idêntica a esta); trocar pela chamada é do pacote das telas, que também
 * ajusta o teste que lê o texto da calculadora.
 *
 * CUIDADOS DE PARIDADE (cada um quebrou ou quebraria o preço de alguém; os testes travam todos):
 *   1. O tempo entra em MINUTOS e vira horas (`/ 60`); a máquina usa `horas * 3600`. Mandar segundos
 *      (`minutos * 60`) muda o custo da máquina na sexta casa em 6,8% dos minutos (123 min dão
 *      7379,999999999999 e não 7380).
 *   2. O peso é a soma em ponto flutuante de modelo, suporte e purga, e só depois `D(...)`. Somar com
 *      Decimal dá outro resultado (o `D(número)` trunca na sexta casa).
 *   3. Cada parcela vai para `operationalCost` como TEXTO de 4 casas (`toString()`): o custo é a soma das
 *      parcelas arredondadas, não a soma exata. Não "simplifique".
 *   4. Mão de obra multiplica pela QUANTIDADE; material, máquina e energia pelas PLACAS
 *      (`ceil(quantidade / peças por placa)`).
 *   5. Embalagem: uma vez por item, só se ligada. Valor inválido ou negativo vale 0.
 *   6. Piso por peça, arredondamento do unitário e total = unitário x quantidade vêm de `fecharPreco`.
 *   7. `1 / 0.9` (preço de equilíbrio) é dividido em ponto flutuante antes do `D(...)`.
 *   8. Nenhuma exceção por entrada ruim: quem chama valida (a tela passa por `num`, o servidor por zod).
 *
 * LIMITE CONHECIDO (não mexer em `decimal.ts` nesta onda: a paridade manda copiar): `Decimal.from(número)`
 * não entende número que o JavaScript escreve com expoente (abaixo de 1e-6 ou a partir de 1e21). Com `1e-7`
 * ele lança; com `6.000000000000001e-8` ele lê 6,000000 em silêncio (o sinal do expoente se perde). Por isso
 * quem chama o servidor passa por `LIMITES_DA_PECA_3D`, que mantém todo número digitado longe do expoente.
 */
import type { Decimal } from "./decimal";
import { D } from "./decimal";
import { energyCost, laborCost, machineCost, materialCost, operationalCost } from "./cost-engine";
import { custoDeEmbalagemDoItem } from "./custo-administrativo";
import { fecharPreco, horasDeMaoDeObraPorPeca, PRECO_MINIMO_POR_PECA } from "./preco";

export type EntradasDaPeca3D = {
  /** Peso do modelo, em gramas. */
  gramasModelo: number;
  pesoSuporteG: number;
  pesoPurgaG: number;
  /** Minutos inteiros (o que `parseTempoLivre` devolve). NÃO converta para segundos antes de chamar. */
  tempoMinutos: number;
  quantidade: number;
  pecasPorPlaca: number;
  /** Horas de pós-processamento POR PEÇA. Zero ou inválido: sem mão de obra. */
  moHoras: number;
  embalagemIncluida: boolean;
  // Taxas: cadastro das impressoras e dos filamentos e base de preço 3D.
  custoPorGrama: number;
  custoHoraMaquina: number;
  potenciaW: number;
  tarifaKwh: number;
  moCustoHora: number;
  embalagemValor: number;
  pctAcabamento: number;
  pctFalha: number;
  markup: number;
  /** Só vira preço de atacado no resultado de quem vê custo. */
  markupAtacado: number;
};

export type ResultadoDaPeca3D = {
  cpg: number;
  custoHora: number;
  material: Decimal;
  maquina: Decimal;
  energia: Decimal;
  maoDeObra: Decimal;
  acabamento: Decimal;
  risco: Decimal;
  indireto: Decimal;
  operacional: Decimal;
  preco: Decimal;
  unitario: Decimal;
  peloMinimo: boolean;
  horasMaoDeObra: number;
  lucro: Decimal;
  margem: Decimal;
  atacado: Decimal;
  markupAtacado: number;
  equilibrio: Decimal;
  horasTotais: number;
  qtd: number;
  pecasPlaca: number;
  placas: number;
  markup: number;
};

export function calcularPeca3D(e: EntradasDaPeca3D): ResultadoDaPeca3D {
  const horasTotais = e.tempoMinutos / 60;
  const gramas = e.gramasModelo + e.pesoSuporteG + e.pesoPurgaG;
  const qtd = e.quantidade || 1;
  // O print do fatiador é UMA impressão (placa) que produz `pecasPlaca` peças. Para `qtd` peças são
  // `placas` impressões: material, máquina e energia escalam por impressão; mão de obra por peça.
  const pecasPlaca = e.pecasPorPlaca || 1;
  const placas = Math.max(1, Math.ceil(qtd / pecasPlaca));

  const materialPlaca = materialCost(D(gramas), e.custoPorGrama);
  const maquinaPlaca = machineCost(horasTotais * 3600, e.custoHoraMaquina);
  const energiaPlaca = energyCost({
    potenciaMediaW: e.potenciaW,
    horasImpressao: horasTotais,
    tarifaKwhSnapshot: e.tarifaKwh,
  });

  const material = materialPlaca.mul(placas);
  const maquina = maquinaPlaca.mul(placas);
  const energia = energiaPlaca.mul(placas);
  const acabamento = material.mul(e.pctAcabamento / 100);
  const risco = material.mul(e.pctFalha / 100);
  // mão de obra: horas de pós-processamento POR PEÇA x quantidade
  const horasMaoDeObra = horasDeMaoDeObraPorPeca(e.moHoras);
  const maoDeObra = laborCost([
    { minutos: horasMaoDeObra * 60, custoHoraSnapshot: e.moCustoHora },
  ]).mul(qtd);
  // embalagem: opcional; quando ligada, cobrada uma vez por item 3D (não multiplica pela quantidade)
  const indireto = custoDeEmbalagemDoItem({
    incluir: e.embalagemIncluida,
    valor: e.embalagemValor,
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
  const markup = e.markup || 2;
  // TOTAL do lote = unitário arredondado x quantidade: o PDF fecha a conta.
  const { preco, unitario, lucro, margem, peloMinimo } = fecharPreco(
    operacional,
    markup,
    qtd,
    PRECO_MINIMO_POR_PECA,
  );
  const markupAtacado = e.markupAtacado || 1.5;
  const equilibrio = operacional.mul(1 / 0.9); // margem de 10%
  return {
    cpg: e.custoPorGrama,
    custoHora: e.custoHoraMaquina,
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
    horasTotais,
    qtd,
    pecasPlaca,
    placas,
    markup,
  };
}

/**
 * Frase que o servidor devolve quando o preço que a tela mostrou já não é o da conta de agora. A tela a
 * reconhece (é o único erro de salvar que pede NOVA cotação) e por isso ela mora aqui, nos dois lados.
 */
export const PRECO_MUDOU_3D =
  "O preço mudou desde a última conta. Confira o novo valor e salve de novo.";

/**
 * Limites do que se aceita digitar de uma peça. O servidor recusa o que está fora (zod, em
 * `lib/api/orcamento-3d.functions.ts`, montado A PARTIR desta constante) e a tela pode validar igual antes de
 * chamar, para a mensagem sair no campo e não depois da espera.
 *
 * Existem por dois motivos: (1) nenhum número digitado chega ao `Decimal` em notação com expoente (ver
 * "LIMITE CONHECIDO" no topo do arquivo); (2) uma peça de 1 ano de impressão ou 100 mil unidades já é o teto
 * do que alguém cota. `inteiro`: o tempo vem de `parseTempoLivre` (minutos inteiros) e quantidade e peças por
 * placa são contagem (o banco arredonda `pecas_por_placa` para inteiro; um 2,5 na tela daria uma conta e outra
 * gravação). `moHoras` vale ZERO ou pelo menos 0,001 hora (3,6 segundos): abaixo de 1,7e-8 hora o produto por
 * 60 vira número com expoente e o `Decimal` o lê errado (1e-9 hora viraria 6 minutos de mão de obra).
 */
export const LIMITES_DA_PECA_3D = {
  gramasModelo: { min: 0.001, max: 100_000, inteiro: false, zeroPermitido: false },
  pesoSuporteG: { min: 0, max: 100_000, inteiro: false, zeroPermitido: true },
  pesoPurgaG: { min: 0, max: 100_000, inteiro: false, zeroPermitido: true },
  tempoMinutos: { min: 1, max: 525_600, inteiro: true, zeroPermitido: false },
  quantidade: { min: 1, max: 100_000, inteiro: true, zeroPermitido: false },
  pecasPorPlaca: { min: 1, max: 10_000, inteiro: true, zeroPermitido: false },
  /** Zero (sem mão de obra) OU de 0,001 a 1.000 horas por peça. */
  moHoras: { min: 0.001, max: 1_000, inteiro: false, zeroPermitido: true },
} as const;

/** Só dizem que um cadastro está zerado. Nunca levam o valor. */
export type AvisoDaCotacao3D =
  | "impressora_sem_custo_hora"
  | "impressora_sem_potencia"
  | "filamento_sem_custo";

/**
 * Cadastro zerado vira aviso, não erro: a peça é cotada e quem cota é avisado de que a conta saiu sem aquela
 * parcela (a calculadora de hoje já avisa do custo/hora; o servidor passa a avisar também da potência e do filamento).
 */
export function avisosDaCotacao(t: {
  custoHoraMaquina: number;
  potenciaW: number;
  custoPorGrama: number;
}): AvisoDaCotacao3D[] {
  const avisos: AvisoDaCotacao3D[] = [];
  if (!(t.custoHoraMaquina > 0)) avisos.push("impressora_sem_custo_hora");
  if (!(t.potenciaW > 0)) avisos.push("impressora_sem_potencia");
  if (!(t.custoPorGrama > 0)) avisos.push("filamento_sem_custo");
  return avisos;
}

/** O que o servidor devolve a quem NÃO tem `impressao3d.cost.read`: preço e mais nada. */
export type CotacaoPublica3D = {
  verCusto: false;
  /** Total do lote, em reais, 2 casas. */
  preco: number;
  /** Reais por peça, 2 casas. */
  unitario: number;
  quantidade: number;
  placas: number;
  pecasPorPlaca: number;
  /** O piso de R$ 5,00 por peça valeu (a tela já mostra o aviso do piso a todos). */
  peloMinimo: boolean;
  avisos: AvisoDaCotacao3D[];
};

export type DecomposicaoDaCotacao3D = {
  material: number;
  maquina: number;
  energia: number;
  maoDeObra: number;
  acabamento: number;
  risco: number;
  indireto: number;
  operacional: number;
  lucro: number;
  margem: number;
  atacado: number;
  equilibrio: number;
  markup: number;
  markupAtacado: number;
};

/** O que o servidor devolve a quem TEM `impressao3d.cost.read`: o mesmo, mais a decomposição. */
export type CotacaoComCusto3D = Omit<CotacaoPublica3D, "verCusto"> & {
  verCusto: true;
  decomposicao: DecomposicaoDaCotacao3D;
};

/**
 * Monta a cotação pública por LISTA EXPLÍCITA de campos. Nunca espalhe (`...r`) o resultado aqui: o dia em
 * que alguém acrescentar um campo de custo a `ResultadoDaPeca3D`, ele não pode vazar para o vendedor.
 */
export function cotacaoPublica(
  r: ResultadoDaPeca3D,
  avisos: AvisoDaCotacao3D[] = [],
): CotacaoPublica3D {
  return {
    verCusto: false,
    preco: r.preco.toNumber(),
    unitario: r.unitario.toNumber(),
    quantidade: r.qtd,
    placas: r.placas,
    pecasPorPlaca: r.pecasPlaca,
    peloMinimo: r.peloMinimo,
    avisos: [...avisos],
  };
}

/** A cotação de quem vê custo. Também por lista explícita de campos. */
export function cotacaoComCusto(
  r: ResultadoDaPeca3D,
  avisos: AvisoDaCotacao3D[] = [],
): CotacaoComCusto3D {
  return {
    verCusto: true,
    preco: r.preco.toNumber(),
    unitario: r.unitario.toNumber(),
    quantidade: r.qtd,
    placas: r.placas,
    pecasPorPlaca: r.pecasPlaca,
    peloMinimo: r.peloMinimo,
    avisos: [...avisos],
    decomposicao: {
      material: r.material.toNumber(),
      maquina: r.maquina.toNumber(),
      energia: r.energia.toNumber(),
      maoDeObra: r.maoDeObra.toNumber(),
      acabamento: r.acabamento.toNumber(),
      risco: r.risco.toNumber(),
      indireto: r.indireto.toNumber(),
      operacional: r.operacional.toNumber(),
      lucro: r.lucro.toNumber(),
      margem: r.margem.toNumber(),
      atacado: r.atacado.toNumber(),
      equilibrio: r.equilibrio.toNumber(),
      markup: r.markup,
      markupAtacado: r.markupAtacado,
    },
  };
}

/** O que a conta não sabe e a tela (ou o servidor) acrescenta ao que grava com a peça. */
export type ExtrasDoItem3d = {
  clienteId: string | null;
  filamentoTipoDetectado: string | null;
  alturaCamadaMm: number | null;
  infillPct: number | null;
  /** Caminho do print do fatiador no Storage. */
  slicerScreenshot: string | null;
  /** Nome da impressora, como o cadastro escreve. */
  impressora: string | null;
  /** Nome do filamento, como o cadastro escreve. */
  filamento: string | null;
};

/**
 * `inputs_json` de `orcamento_3d_calculos`, chave por chave como a calculadora o grava hoje. A RPC
 * `salvar_item_3d_no_orcamento`, `ler_item_3d`, `breakdown_3d`, `orcamento-3d.$id` e a reabertura da peça leem
 * estas chaves: o formato tem de ser UM só, venha o salvamento do navegador ou do servidor.
 *
 * `e` é o que entrou na conta e `r` o que ela devolveu. O `markup` gravado é o DIGITADO (`e.markup`), antes
 * do `|| 2` da conta, como sempre foi.
 */
export function inputsDoItem3d(e: EntradasDaPeca3D, r: ResultadoDaPeca3D, x: ExtrasDoItem3d) {
  return {
    cliente_id: x.clienteId,
    quantidade: r.qtd,
    gramas: e.gramasModelo,
    peso_suporte_g: e.pesoSuporteG,
    peso_purga_g: e.pesoPurgaG,
    pecas_por_placa: r.pecasPlaca,
    filamento_tipo_detectado: x.filamentoTipoDetectado,
    altura_camada_mm: x.alturaCamadaMm,
    infill_pct: x.infillPct,
    horas_totais: r.horasTotais,
    custo_hora_maquina: e.custoHoraMaquina,
    potencia_w: e.potenciaW,
    tarifa_kwh: e.tarifaKwh,
    mao_obra: { custo_hora: e.moCustoHora, horas: r.horasMaoDeObra },
    pct_acabamento: e.pctAcabamento,
    pct_falha: e.pctFalha,
    custo_admin: e.embalagemIncluida ? e.embalagemValor : 0,
    embalagem_incluida: e.embalagemIncluida,
    embalagem_valor: e.embalagemIncluida ? r.indireto.toNumber() : 0,
    markup: e.markup,
    slicer_screenshot: x.slicerScreenshot,
    impressora: x.impressora,
    filamento: x.filamento,
  };
}

/** `resultados_json` de `orcamento_3d_calculos`, como a calculadora o grava hoje. */
export function resultadosDoItem3d(e: EntradasDaPeca3D, r: ResultadoDaPeca3D) {
  return {
    material: r.material.toNumber(),
    maquina: r.maquina.toNumber(),
    energia: r.energia.toNumber(),
    mao_de_obra: r.maoDeObra.toNumber(),
    acabamento: r.acabamento.toNumber(),
    risco: r.risco.toNumber(),
    indireto: r.indireto.toNumber(),
    embalagem_incluida: e.embalagemIncluida,
    embalagem: r.indireto.toNumber(),
    operacional: r.operacional.toNumber(),
    preco: r.preco.toNumber(),
    margem: r.margem.toNumber(),
  };
}
