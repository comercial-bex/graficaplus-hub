/**
 * A CONTA DE PREÇO DO TROFÉU DE ACRÍLICO (22/11/2026). Função pura: sem React, sem banco e sem tela.
 *
 * Um troféu é uma LISTA DE PEÇAS (placa impressa, coluna, aro, silhueta gravada, base em camadas). Cada peça tem
 * material, medida na altura de referência do modelo, quantas iguais se empilham, quanto o contorno é mais longo que
 * o de um retângulo e como é decorada. Escolher outra altura escala tudo sozinho: a área cresce ao quadrado, o corte
 * e o perímetro crescem na proporção. A conta é a MESMA do custo cheio do produto (`custo_cheio_do_produto`):
 *
 *   custo cheio       = material (área útil) + decoração + cola + máquina + mão de obra + rateio
 *   custo de produção = material com sobra de corte e falha + máquina + mão de obra + rateio + ocupação
 *                       (a ocupação alvo da casa soma de novo máquina, mão de obra e rateio)
 *   preço             = custo cheio × multiplicador   (a regra do ×3 do dono, 22/11/2026)
 *   multiplicador     = máximo entre (base da linha × fator da faixa de quantidade) e o piso (×2,2)
 *   margem líquida    = (preço sem imposto e sem metade do cartão − custo de produção) ÷ preço
 *
 * O material entra pela ÁREA ÚTIL da chapa (2,00 m² na Terzian 1030 × 2030, borda é sobra): o custo por m² que chega
 * aqui já é o do cadastro, que a migração 20261122100000 corrigiu. Esta função não lê preço de lugar nenhum: quem a
 * chama (o servidor) entrega as taxas, e taxa que falta é ERRO em português, nunca preço com número de fábrica.
 * Dinheiro sai em centavos inteiros; as parcelas somam em reais e arredondam uma vez só, no fim.
 */

export type Decoracao = "nenhuma" | "vinil_laminado" | "gravacao_laser";

export type LinhaDoTrofeu = "economico" | "padrao" | "premium";

export type PecaDoModelo = {
  nome: string;
  materialId: string;
  espessuraMm: number;
  /** Medidas na altura de referência do modelo, em metros. */
  larguraM: number;
  alturaM: number;
  /** Quantas peças iguais se empilham (as camadas de uma base). */
  quantidade: number;
  /** Perímetro real ÷ perímetro do retângulo. 1 = retângulo; contorno recortado passa de 1. */
  fatorDeForma: number;
  decoracao: Decoracao;
};

export type ModeloDeTrofeu = {
  id: string;
  nome: string;
  linha: LinhaDoTrofeu;
  alturaDeReferenciaM: number;
  pecas: PecaDoModelo[];
  /** Minutos de mão de obra por troféu na altura de referência (montagem, cola, limpeza). */
  minutosDeMaoDeObra: number;
  /** O ×3 da linha. O premium exclusivo sobe para ×3,5. */
  multiplicadorBase: number;
};

export type TaxasDoTrofeu = {
  /** R$ por m² ÚTIL de cada material, pelo id do material. */
  custoM2PorMaterial: Record<string, number | null | undefined>;
  /** Percentuais: 8 é 8%. */
  pctPerdaMaterial: number;
  pctFalhaProducao: number;
  vinilM2: number;
  laminacaoM2: number;
  tintaMlM2: number;
  custoMlTinta: number;
  /** Plotter de impressão, por m² (hora ÷ velocidade de cálculo, mais energia). */
  plotterM2: number;
  colaMlPorJuncao: number;
  custoMlCola: number;
  /** Laser CO2: custo por hora com a energia já somada. */
  laserHora: number;
  /** Metros cortados por minuto, por espessura em mm. */
  velocidadeDeCorteMPorMin: Record<string, number>;
  gravacaoMinPorM2: number;
  preparoDoLaserMin: number;
  /** Mão de obra por hora, com encargos. */
  moHora: number;
  adminHora: number;
  ocupacaoAlvoPct: number;
  impostoPct: number;
  cartaoPct: number;
};

export type FaixaDeQuantidade = { de: number; fator: number };

export type RegrasDoTrofeu = {
  /** Da menor quantidade para a maior. O fator multiplica a base da linha. */
  faixas: FaixaDeQuantidade[];
  pisoDoMultiplicador: number;
  multiplicadorDeUrgencia: number;
  alturaMinimaM: number;
  alturaMaximaM: number;
};

export type EntradaDoTrofeu = {
  modelo: ModeloDeTrofeu;
  alturaM: number;
  quantidade: number;
  urgente?: boolean;
};

export type ResultadoDoTrofeu = {
  alturaM: number;
  fatorDeEscala: number;
  pecas: number;
  areaUtilM2: number;
  corteM: number;
  minutosDeLaser: number;
  minutosDeMaoDeObra: number;
  custo: {
    material: number;
    decoracao: number;
    cola: number;
    maquina: number;
    maoDeObra: number;
    indireto: number;
  };
  custoCheio: number;
  custoDeProducao: number;
  multiplicador: number;
  faixaDe: number;
  precoCalculado: number;
  precoUnitario: number;
  precoTotal: number;
  margemLiquidaPct: number;
};

export class ErroDoTrofeu extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDoTrofeu";
  }
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * O preço fecha em ,90: o menor valor terminado em ,90 que não fica abaixo do calculado.
 * 55,79 vira 55,90; 84,95 vira 85,90 (84,90 ficaria abaixo do calculado); 193,05 vira 193,90.
 */
export function fecharEm90(preco: number): number {
  if (!(preco > 0)) return 0;
  return centavos(Math.ceil(preco + 0.1 - 1e-9) - 0.1);
}

/** O multiplicador de uma quantidade: a base da linha vezes o fator da faixa, nunca abaixo do piso. */
export function multiplicadorDaQuantidade(
  base: number,
  quantidade: number,
  regras: RegrasDoTrofeu,
  urgente = false,
): { multiplicador: number; faixaDe: number } {
  const faixas = [...regras.faixas].sort((a, b) => a.de - b.de);
  let faixa = faixas[0];
  for (const f of faixas) if (quantidade >= f.de) faixa = f;
  const baseDaVenda = urgente ? Math.max(base, regras.multiplicadorDeUrgencia) : base;
  const multiplicador = Math.max(baseDaVenda * faixa.fator, regras.pisoDoMultiplicador);
  return { multiplicador: Math.round(multiplicador * 10000) / 10000, faixaDe: faixa.de };
}

/** Lança ErroDoTrofeu se a condição falha. É uma asserção: depois dela, o TypeScript sabe que a condição vale. */
function exigir(condicao: boolean, mensagem: string): asserts condicao {
  if (!condicao) throw new ErroDoTrofeu(mensagem);
}

/** Calcula custo, preço e margem de um troféu. Lança ErroDoTrofeu quando falta taxa ou a entrada não vale. */
export function calcularTrofeu(entrada: EntradaDoTrofeu, taxas: TaxasDoTrofeu, regras: RegrasDoTrofeu): ResultadoDoTrofeu {
  const { modelo, alturaM, quantidade } = entrada;
  exigir(Number.isFinite(alturaM) && alturaM > 0, "Informe a altura do troféu.");
  exigir(
    alturaM >= regras.alturaMinimaM && alturaM <= regras.alturaMaximaM,
    `A altura vai de ${regras.alturaMinimaM * 100} a ${regras.alturaMaximaM * 100} cm.`,
  );
  exigir(Number.isInteger(quantidade) && quantidade > 0, "Informe a quantidade de troféus, em número inteiro.");
  exigir(modelo.pecas.length > 0, "O modelo não tem peças.");
  exigir(modelo.alturaDeReferenciaM > 0, "O modelo não tem altura de referência.");

  const f = alturaM / modelo.alturaDeReferenciaM;
  // Em percentual, e não em fração: 0,6 + 0,3 dá 0,8999… e deixaria 90% passar.
  exigir(taxas.pctPerdaMaterial >= 0 && taxas.pctFalhaProducao >= 0, "Perda e falha não podem ser negativas.");
  exigir(taxas.pctPerdaMaterial + taxas.pctFalhaProducao < 90, "A soma de perda e falha não pode passar de 90%.");
  const perda = taxas.pctPerdaMaterial / 100;
  const falha = taxas.pctFalhaProducao / 100;

  let areaUtil = 0;
  let material = 0;
  let decoracao = 0;
  let corteM = 0;
  let gravacaoMin = 0;
  let pecas = 0;
  let minutosCorte = 0;

  for (const peca of modelo.pecas) {
    const custoM2 = taxas.custoM2PorMaterial[peca.materialId];
    exigir(custoM2 != null && custoM2 > 0, `O material de "${peca.nome}" está sem custo por m² no cadastro. Avise a gerência.`);
    const velocidade = taxas.velocidadeDeCorteMPorMin[String(peca.espessuraMm)];
    exigir(velocidade != null && velocidade > 0, `Falta a velocidade de corte do acrílico de ${peca.espessuraMm} mm.`);

    const area = peca.larguraM * f * (peca.alturaM * f) * peca.quantidade;
    const perimetro = 2 * (peca.larguraM + peca.alturaM) * f * peca.fatorDeForma * peca.quantidade;
    areaUtil += area;
    material += area * custoM2;
    corteM += perimetro;
    minutosCorte += perimetro / velocidade;
    pecas += peca.quantidade;

    if (peca.decoracao === "vinil_laminado") {
      decoracao += area * (taxas.vinilM2 + taxas.laminacaoM2 + taxas.tintaMlM2 * taxas.custoMlTinta + taxas.plotterM2);
    } else if (peca.decoracao === "gravacao_laser") {
      gravacaoMin += area * taxas.gravacaoMinPorM2;
    }
  }

  const cola = Math.max(pecas - 1, 0) * taxas.colaMlPorJuncao * taxas.custoMlCola;
  const minutosDeLaser = minutosCorte + gravacaoMin + taxas.preparoDoLaserMin / quantidade;
  const maquina = (minutosDeLaser / 60) * taxas.laserHora;
  const minutosDeMaoDeObra = modelo.minutosDeMaoDeObra * f;
  const maoDeObra = (minutosDeMaoDeObra / 60) * taxas.moHora;
  const indireto = (minutosDeMaoDeObra / 60) * taxas.adminHora;

  const materialDoCusto = material + decoracao + cola;
  const custoCheio = materialDoCusto + maquina + maoDeObra + indireto;
  const ocupacao = (maquina + maoDeObra + indireto) * (100 / Math.min(Math.max(taxas.ocupacaoAlvoPct, 5), 100) - 1);
  const custoDeProducao = materialDoCusto / (1 - perda - falha) + maquina + maoDeObra + indireto + ocupacao;

  const { multiplicador, faixaDe } = multiplicadorDaQuantidade(modelo.multiplicadorBase, quantidade, regras, entrada.urgente);
  const precoCalculado = custoCheio * multiplicador;
  const precoUnitario = fecharEm90(precoCalculado);
  const retencao = 1 - (taxas.impostoPct + taxas.cartaoPct / 2) / 100;
  const margemLiquida = precoUnitario > 0 ? (precoUnitario * retencao - custoDeProducao) / precoUnitario : 0;

  return {
    alturaM,
    fatorDeEscala: Math.round(f * 10000) / 10000,
    pecas,
    areaUtilM2: Math.round(areaUtil * 10000) / 10000,
    corteM: Math.round(corteM * 1000) / 1000,
    minutosDeLaser: Math.round(minutosDeLaser * 100) / 100,
    minutosDeMaoDeObra: Math.round(minutosDeMaoDeObra * 100) / 100,
    custo: {
      material: centavos(material),
      decoracao: centavos(decoracao),
      cola: centavos(cola),
      maquina: centavos(maquina),
      maoDeObra: centavos(maoDeObra),
      indireto: centavos(indireto),
    },
    custoCheio: centavos(custoCheio),
    custoDeProducao: centavos(custoDeProducao),
    multiplicador,
    faixaDe,
    precoCalculado: centavos(precoCalculado),
    precoUnitario,
    precoTotal: centavos(precoUnitario * quantidade),
    margemLiquidaPct: Math.round(margemLiquida * 1000) / 10,
  };
}

// ------------------------------------------------------------------------------------------------------
// A arte do troféu: linha separada do orçamento
// ------------------------------------------------------------------------------------------------------

export type TipoDeArte = "cliente_manda" | "adaptar_modelo" | "criacao_exclusiva";

export type RegrasDaArte = {
  /** Horas de designer de uma criação exclusiva (a KR Combat levou cerca de 3). */
  horasDaCriacaoExclusiva: number;
  multiplicador: number;
  /** A criação exclusiva fecha na dezena: 222,60 vira 220,00. */
  arredondarNaDezena: boolean;
  /** Desconto da criação exclusiva a partir desta quantidade de troféus. Zero desliga. */
  descontoAPartirDe: number;
  descontoPct: number;
  alteracaoExtra: number;
  nomeIndividualPorPeca: number;
};

export type EntradaDaArte = {
  tipo: TipoDeArte;
  quantidadeDeTrofeus: number;
  alteracoesExtras?: number;
  /** Quantos troféus levam um nome diferente cada. */
  nomesIndividuais?: number;
};

export type LinhaDaArte = { descricao: string; valor: number };

export function precoDaArte(
  entrada: EntradaDaArte,
  taxas: Pick<TaxasDoTrofeu, "moHora" | "adminHora" | "ocupacaoAlvoPct">,
  regras: RegrasDaArte,
): { linhas: LinhaDaArte[]; total: number } {
  exigir(Number.isInteger(entrada.quantidadeDeTrofeus) && entrada.quantidadeDeTrofeus > 0, "Informe a quantidade de troféus.");
  const alteracoes = Math.max(entrada.alteracoesExtras ?? 0, 0);
  const nomes = Math.max(entrada.nomesIndividuais ?? 0, 0);
  exigir(Number.isInteger(alteracoes) && Number.isInteger(nomes), "Alterações e nomes se contam em número inteiro.");
  exigir(nomes <= entrada.quantidadeDeTrofeus, "Há mais nomes individuais do que troféus.");

  const linhas: LinhaDaArte[] = [];
  if (entrada.tipo === "criacao_exclusiva") {
    const custo = regras.horasDaCriacaoExclusiva * (taxas.moHora + taxas.adminHora);
    let valor = custo * regras.multiplicador;
    if (regras.arredondarNaDezena) valor = Math.round(valor / 10) * 10;
    const desconto = regras.descontoAPartirDe > 0 && entrada.quantidadeDeTrofeus >= regras.descontoAPartirDe;
    if (desconto) valor = valor * (1 - regras.descontoPct / 100);
    linhas.push({
      descricao: desconto ? `Criação exclusiva da arte (com ${regras.descontoPct}% de desconto pela quantidade)` : "Criação exclusiva da arte",
      valor: centavos(valor),
    });
  }
  if (alteracoes > 0) linhas.push({ descricao: `Alteração extra da arte (${alteracoes})`, valor: centavos(alteracoes * regras.alteracaoExtra) });
  if (nomes > 0) linhas.push({ descricao: `Nome individual (${nomes} troféus)`, valor: centavos(nomes * regras.nomeIndividualPorPeca) });
  return { linhas, total: centavos(linhas.reduce((s, l) => s + l.valor, 0)) };
}
