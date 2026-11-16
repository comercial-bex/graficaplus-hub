/**
 * Painel "O que melhora o lucro" do simulador de preço. Funções puras, sem React, sem banco e sem gravar nada.
 *
 * Para o produto e o preço que estão no simulador, devolve uma lista curta, ordenada pelo ganho em reais por unidade.
 * Tudo em CENTAVOS INTEIROS, como o simulador. Só lê o que a tela já recebe. Falta dado, a alavanca vira "sem dado"
 * com o que falta, e nunca ganha número inventado.
 *
 * Lucro por unidade = preço, menos o custo de produção, menos imposto e metade do cartão sobre o preço. Por isso:
 *   subir o preço em R$ 1 dá (1 menos a taxa) de lucro, e as alavancas de custo valem o custo que saiu, inteiro,
 *   no mesmo preço. As alavancas de custo e a de preço se somam sem contar duas vezes.
 *
 * Ocupação, conforme custo_cheio_do_produto na migração 20261116130000:
 *   custo_ocupacao = base x (100 / ocupação - 1), com base = máquina sem energia + mão de obra + rateio.
 *   Logo base = custo_ocupacao x ocupação / (100 - ocupação), e a conversão numa ocupação t custa base x 100 / t.
 *   Subir de o para t baixa o custo de produção em base x (100 / o - 100 / t). Em ocupação 100 o custo de ocupação é
 *   zero e a base não se deduz: a alavanca vira "sem dado", sem divisão por zero.
 *   A visão entrega custo_ocupacao arredondado a 2 casas, então o ganho é arredondado para BAIXO no centavo.
 *
 * Perda e falha: material com perda e falha = material / (1 - perda e falha somadas). A tela recebe o material com perda
 * (de tres_x_material e do multiplicador) e o material da ficha, e deduz a soma das duas porcentagens daí.
 *
 * Sem parênteses, travessão ou seta nos textos.
 */
import { type LinhaDePreco } from "./painel-de-precos";
import { leituraDoMinimo, margemMinimaUsada } from "./preco-minimo";
import {
  motivosDoCustoIncompleto,
  reaisPorExtenso,
  simularNoPreco,
  type Simulacao,
  type SimuladorPronto,
} from "./simulador-de-preco";

export type CodigoDaAlavanca =
  | "preco_ate_minimo"
  | "ocupacao_60"
  | "ocupacao_70"
  | "perda_e_falha"
  | "preco_do_parceiro";

/** A quem cabe a decisão. */
export type QuemDecide = "gerente" | "dono" | "producao";

export const ROTULO_DE_QUEM: Record<QuemDecide, string> = {
  gerente: "Gerente aprova a proposta de preço",
  dono: "Dono decide, com vendas e agenda",
  producao: "Produção e dono, na rotina da oficina",
};

export type FiltroDeAlavancas = "todas" | QuemDecide;

export const ROTULO_DO_FILTRO: Record<FiltroDeAlavancas, string> = {
  todas: "Todas",
  gerente: "Preço, com o gerente",
  dono: "Ocupação, com o dono",
  producao: "Perda e falha, com a produção",
};

/** Ordem de desempate: preço, ocupação, perda e falha, parceiro. */
const PRIORIDADE: Record<CodigoDaAlavanca, number> = {
  preco_ate_minimo: 0,
  ocupacao_60: 1,
  ocupacao_70: 2,
  perda_e_falha: 3,
  preco_do_parceiro: 4,
};

export type AlavancaPronta = {
  estado: "pronta";
  codigo: CodigoDaAlavanca;
  /** O que fazer, em poucas palavras. */
  titulo: string;
  /** A conta em frase simples, com os números. */
  frase: string;
  /** Ganho de lucro por unidade, em centavos. Sempre maior que zero. */
  ganhoCentavos: number;
  /** Ganho em pontos de lucro sobre o preço. */
  ganhoPontos: number;
  /** Lucro por unidade depois da alavanca, em centavos. */
  lucroDepoisCentavos: number;
  quem: QuemDecide;
  /** Preço que a alavanca de preço pede, em centavos. Só nas alavancas de preço do balcão. */
  precoAlvoCentavos: number | null;
  /** Só a alavanca de preço do balcão tem o botão Propor, que já existe na tela. */
  podePropor: boolean;
  /** Frase de cautela que vale para esta alavanca. */
  cautela: string;
};

export type AlavancaSemDado = {
  estado: "sem_dado";
  codigo: CodigoDaAlavanca;
  titulo: string;
  /** O que falta, em frase. */
  frase: string;
  quem: QuemDecide;
};

export type PainelDeAlavancas = {
  prontas: AlavancaPronta[];
  semDado: AlavancaSemDado[];
  /** Mesmos motivos do selo do simulador. Vazio quando o custo está completo. */
  custoIncompleto: string[];
  /**
   * Soma do ganho das alavancas do balcão que se somam sem contar duas vezes: o preço, a maior ocupação e a perda e
   * falha. Nulo quando há menos de duas. A do parceiro é outra venda e fica de fora.
   */
  somaDoBalcaoCentavos: number | null;
};

export type OpcoesDasAlavancas = {
  /** Quem não vê custo não recebe a alavanca do parceiro. A tela já exige ver custo, e isto repete a trava. */
  podeVerCusto?: boolean;
};

export const OCUPACOES_TESTADAS = [60, 70] as const;

const numeroOk = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positivo = (n: unknown): n is number => numeroOk(n) && n > 0;
const centavosDe = (n: number) => Math.round(n * 100);
const pctTexto = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function pontosDeMargem(antes: Simulacao, depois: Simulacao): number {
  return depois.lucroPct - antes.lucroPct;
}

function simular(p: SimuladorPronto, c: number): Simulacao | null {
  const s = simularNoPreco(p, c);
  return s.estado === "ok" ? s : null;
}

const CAUTELA_DO_PRECO =
  "O ganho só vale se a venda se mantiver nesse preço. Quem muda o preço é uma pessoa, depois que o gerente aprova.";

/**
 * a) Subir o preço até o mínimo recomendado. O mínimo é o piso: acima dele não há alavanca de preço. A referência de
 * três vezes o custo real serve só para comparar em /precos, não manda subir e por isso não entra aqui nem na soma.
 */
function alavancaDePreco(p: SimuladorPronto, atual: Simulacao): AlavancaPronta | null {
  const preco = atual.precoCentavos;
  const minimo = p.minimoCentavos;
  if (minimo == null || preco >= minimo) return null;
  const alvo = minimo;
  const titulo = `Subir o preço até o mínimo recomendado, ${reaisPorExtenso(minimo)}`;

  const depois = simular(p, alvo);
  if (depois == null) return null;
  const ganho = depois.lucroCentavos - atual.lucroCentavos;
  if (ganho <= 0) return null;
  const sobe = alvo - preco;
  return {
    estado: "pronta",
    codigo: "preco_ate_minimo",
    titulo,
    frase: `O preço sobe ${reaisPorExtenso(sobe)}, de ${reaisPorExtenso(preco)} para ${reaisPorExtenso(alvo)}. O lucro por unidade vai de ${lucroTexto(atual.lucroCentavos)} para ${lucroTexto(depois.lucroCentavos)}.`,
    ganhoCentavos: ganho,
    ganhoPontos: pontosDeMargem(atual, depois),
    lucroDepoisCentavos: depois.lucroCentavos,
    quem: "gerente",
    precoAlvoCentavos: alvo,
    podePropor: true,
    cautela: CAUTELA_DO_PRECO,
  };
}

function lucroTexto(c: number): string {
  return c < 0 ? `prejuízo de ${reaisPorExtenso(-c)}` : reaisPorExtenso(c);
}

/** b) Subir a ocupação alvo para 60 e para 70. Devolve as alavancas que cabem, ou o motivo de não haver. */
function alavancasDeOcupacao(
  linha: LinhaDePreco,
  atual: Simulacao,
  p: SimuladorPronto,
): { prontas: AlavancaPronta[]; semDado: AlavancaSemDado[] } {
  const r = linha.real;
  const o = r?.ocupacao_alvo_pct;
  const co = r?.custo_ocupacao;
  const semDado = (frase: string): { prontas: AlavancaPronta[]; semDado: AlavancaSemDado[] } => ({
    prontas: [],
    semDado: [
      {
        estado: "sem_dado",
        codigo: "ocupacao_60",
        titulo: "Subir a ocupação alvo para 60 ou 70 por cento",
        frase,
        quem: "dono",
      },
    ],
  });
  if (!positivo(o) || !numeroOk(co))
    return semDado(
      "Este produto não tem ocupação alvo para medir. Ela não se aplica a serviço de custo digitado nem a produto sem máquina padrão. Se o produto tem máquina padrão, o banco ainda não entregou o campo.",
    );
  if (o >= 100)
    return semDado(
      "A ocupação alvo já está em 100 por cento. Não há horas paradas para tirar do custo, e a conta não tem como partir daí.",
    );
  if (!(co > 0))
    return semDado(
      "Este produto não tem horas de máquina, mão de obra ou rateio sujeitas à ocupação, então ela não muda o custo dele.",
    );

  const base = (co * o) / (100 - o);
  const prontas: AlavancaPronta[] = [];
  for (const t of OCUPACOES_TESTADAS) {
    if (!(t > o)) continue;
    const reducao = base * (100 / o - 100 / t);
    const ganho = Math.floor(reducao * 100 + 1e-9);
    if (ganho < 1) continue;
    const lucroDepois = atual.lucroCentavos + ganho;
    const codigo: CodigoDaAlavanca = t === 60 ? "ocupacao_60" : "ocupacao_70";
    prontas.push({
      estado: "pronta",
      codigo,
      titulo: `Subir a ocupação alvo de ${pctTexto(o)} para ${t} por cento`,
      frase: `O custo de conversão por unidade, que é a máquina sem energia, a mão de obra e o rateio, cai ${reaisPorExtenso(ganho)}, de ${reaisPorExtenso(centavosDe(base * (100 / o)))} para ${reaisPorExtenso(centavosDe(base * (100 / t)))}. No mesmo preço, o lucro vai de ${lucroTexto(atual.lucroCentavos)} para ${lucroTexto(lucroDepois)}.`,
      ganhoCentavos: ganho,
      ganhoPontos: (ganho / atual.precoCentavos) * 100,
      lucroDepoisCentavos: lucroDepois,
      quem: "dono",
      precoAlvoCentavos: null,
      podePropor: false,
      cautela:
        "Ocupação é decisão de vendas e agenda, não um botão. Mudar o número em Custos fixos e mão de obra só baixa o custo no papel. O ganho de verdade vem de vender mais horas de máquina. Os ganhos de 60 e de 70 não se somam, o de 70 já inclui o de 60.",
    });
  }
  if (prontas.length === 0)
    return semDado(
      OCUPACOES_TESTADAS.some((t) => t > o)
        ? `Subir a ocupação alvo de ${pctTexto(o)} para 60 ou 70 por cento ganha menos de um centavo por unidade neste produto, pequeno demais para medir.`
        : `A ocupação alvo já é de ${pctTexto(o)} por cento. Não há 60 nem 70 por cento para subir.`,
    );
  return { prontas, semDado: [] };
}

/** c) Baixar a perda e a falha somadas em um ponto, a partir do material com perda que a tela já recebe. */
function alavancaDePerdaEFalha(
  linha: LinhaDePreco,
  atual: Simulacao,
): AlavancaPronta | AlavancaSemDado {
  const semDado = (frase: string): AlavancaSemDado => ({
    estado: "sem_dado",
    codigo: "perda_e_falha",
    titulo: "Baixar a perda e a falha de produção",
    frase,
    quem: "producao",
  });
  const comPerda = leituraDoMinimo(linha, atual.precoCentavos / 100).materialComPerda;
  const material = linha.composicao?.material;
  if (comPerda == null)
    return semDado(
      "Falta o material com perda e falha. Ele sai do multiplicador da regra de três e do valor de três vezes o material, que o banco ainda não entregou para este produto.",
    );
  if (!positivo(material))
    return semDado(
      "Falta o custo de material da ficha, então não dá para separar quanto do material é perda e falha.",
    );
  const perdas = comPerda - material;
  if (perdas < 0.01)
    return semDado(
      "A perda e a falha estão em zero neste produto, ou são pequenas demais para medir pelo que a tela recebe.",
    );

  const d = material / comPerda;
  const pctAtual = (1 - d) * 100;
  const passo = Math.min(1, pctAtual);
  const pctNovo = pctAtual - passo;
  const perdasNovas = material / (1 - pctNovo / 100) - material;
  const ganho = Math.floor((perdas - perdasNovas) * 100 + 1e-9);
  if (ganho < 1)
    return semDado("O ganho de reduzir a perda e a falha é menor que um centavo por unidade.");
  const lucroDepois = atual.lucroCentavos + ganho;
  return {
    estado: "pronta",
    codigo: "perda_e_falha",
    titulo: `Baixar a perda e a falha somadas em ${pctTexto(passo)} ponto`,
    frase: `A perda e a falha somadas valem cerca de ${pctTexto(pctAtual)} por cento do material, ${reaisPorExtenso(centavosDe(perdas))} por unidade. Com ${pctTexto(pctNovo)} por cento, o custo cai ${reaisPorExtenso(ganho)} por unidade. No mesmo preço, o lucro vai de ${lucroTexto(atual.lucroCentavos)} para ${lucroTexto(lucroDepois)}.`,
    ganhoCentavos: ganho,
    ganhoPontos: (ganho / atual.precoCentavos) * 100,
    lucroDepoisCentavos: lucroDepois,
    quem: "producao",
    precoAlvoCentavos: null,
    podePropor: false,
    cautela:
      "A porcentagem é deduzida do material com perda que a tela recebe, não do cadastro dos parâmetros. Perder menos é trabalho da oficina, com refile, falhas e retrabalho. Mudar o parâmetro sem mudar a oficina só baixa o custo no papel.",
  };
}

/** d) Subir o preço do parceiro até o piso líquido, só até o preço simulado do balcão. */
function alavancaDoParceiro(
  linha: LinhaDePreco,
  p: SimuladorPronto,
  atual: Simulacao,
): AlavancaPronta | AlavancaSemDado | null {
  if (linha.real?.parceiro_abaixo_do_piso !== true) return null;
  const semDado = (frase: string): AlavancaSemDado => ({
    estado: "sem_dado",
    codigo: "preco_do_parceiro",
    titulo: "Subir o preço do parceiro até o piso líquido",
    frase,
    quem: "gerente",
  });
  const precoParceiro = linha.preco_parceiro;
  const custoReal = linha.real?.custo_real;
  if (!positivo(precoParceiro) || !positivo(custoReal))
    return semDado("Falta o preço do parceiro ou o custo real para calcular o piso líquido.");
  const m = margemMinimaUsada(linha.margem_minima);
  if (m >= 100) return semDado("A margem mínima do produto não permite calcular o piso líquido.");

  const pisoLiquido = Math.ceil(Math.round((custoReal / (1 - m / 100)) * 1e6) / 1e4);
  const atualParceiro = centavosDe(precoParceiro);
  if (pisoLiquido <= atualParceiro) return null;
  const balcao = atual.precoCentavos;
  const alvo = Math.min(pisoLiquido, balcao);
  if (alvo <= atualParceiro)
    return semDado(
      `O preço do parceiro, ${reaisPorExtenso(atualParceiro)}, já está no preço simulado do balcão, ${reaisPorExtenso(balcao)}, e o parceiro não pode passar do balcão. O piso líquido é ${reaisPorExtenso(pisoLiquido)}. Para fechar a conta, o balcão também precisa subir.`,
    );
  const antes = simular(p, atualParceiro);
  const depois = simular(p, alvo);
  if (antes == null || depois == null) return null;
  const ganho = depois.lucroCentavos - antes.lucroCentavos;
  if (ganho <= 0) return null;
  const limitado = alvo < pisoLiquido;
  return {
    estado: "pronta",
    codigo: "preco_do_parceiro",
    titulo: limitado
      ? `Subir o preço do parceiro até o balcão simulado, ${reaisPorExtenso(alvo)}`
      : `Subir o preço do parceiro até o piso líquido, ${reaisPorExtenso(alvo)}`,
    frase: `O parceiro paga ${reaisPorExtenso(atualParceiro)} e o piso líquido é ${reaisPorExtenso(pisoLiquido)}, que deixa a margem mínima de ${pctTexto(m)} por cento depois do custo real. Subindo para ${reaisPorExtenso(alvo)}, cada unidade vendida a ele deixa ${reaisPorExtenso(ganho)} a mais, de ${lucroTexto(antes.lucroCentavos)} para ${lucroTexto(depois.lucroCentavos)}.${limitado ? ` Mesmo assim fica abaixo do piso líquido, porque o parceiro não pode passar do balcão. O balcão também precisa subir.` : ""}`,
    ganhoCentavos: ganho,
    ganhoPontos: pontosDeMargem(antes, depois),
    lucroDepoisCentavos: depois.lucroCentavos,
    quem: "gerente",
    precoAlvoCentavos: alvo,
    podePropor: false,
    cautela:
      "O ganho é por unidade vendida ao parceiro, não por unidade de balcão. O preço do parceiro se corrige no preço do produto. O botão Propor desta tela só trata o preço do balcão.",
  };
}

/** Ordena do maior ganho para o menor. No empate vale a ordem fixa: preço, ocupação, perda e falha, parceiro. */
export function ordenarAlavancas<T extends { codigo: CodigoDaAlavanca; ganhoCentavos?: number }>(
  lista: T[],
): T[] {
  return [...lista].sort((a, b) => {
    const dif = (b.ganhoCentavos ?? 0) - (a.ganhoCentavos ?? 0);
    return dif !== 0 ? dif : PRIORIDADE[a.codigo] - PRIORIDADE[b.codigo];
  });
}

/** Filtra por quem decide. "todas" devolve a lista como está. */
export function filtrarAlavancas<T extends { quem: QuemDecide }>(
  lista: T[],
  filtro: FiltroDeAlavancas,
): T[] {
  return filtro === "todas" ? lista : lista.filter((a) => a.quem === filtro);
}

/**
 * O painel para o produto e o preço do simulador. Recebe o simulador já pronto e a simulação no preço escolhido.
 * Não grava nada e não lê nada além do que a linha já traz.
 */
export function alavancasDeLucro(
  linha: LinhaDePreco,
  pronto: SimuladorPronto,
  simulacao: Simulacao,
  opcoes: OpcoesDasAlavancas = {},
): PainelDeAlavancas {
  const prontas: AlavancaPronta[] = [];
  const semDado: AlavancaSemDado[] = [];

  const preco = alavancaDePreco(pronto, simulacao);
  if (preco) prontas.push(preco);

  const ocupacao = alavancasDeOcupacao(linha, simulacao, pronto);
  prontas.push(...ocupacao.prontas);
  semDado.push(...ocupacao.semDado);

  const perda = alavancaDePerdaEFalha(linha, simulacao);
  if (perda.estado === "pronta") prontas.push(perda);
  else semDado.push(perda);

  if (opcoes.podeVerCusto !== false) {
    const parceiro = alavancaDoParceiro(linha, pronto, simulacao);
    if (parceiro?.estado === "pronta") prontas.push(parceiro);
    else if (parceiro) semDado.push(parceiro);
  }

  const ordenadas = ordenarAlavancas(prontas);

  // Soma do balcão: o preço, a maior ocupação e a perda e falha. As duas ocupações não se somam, vale a maior.
  const doBalcao = ordenadas.filter((a) => a.codigo !== "preco_do_parceiro");
  const maiorOcupacao = doBalcao
    .filter((a) => a.codigo === "ocupacao_60" || a.codigo === "ocupacao_70")
    .reduce<AlavancaPronta | null>(
      (m, a) => (m == null || a.ganhoCentavos > m.ganhoCentavos ? a : m),
      null,
    );
  const somaveis = doBalcao.filter(
    (a) => !(a.codigo === "ocupacao_60" || a.codigo === "ocupacao_70") || a === maiorOcupacao,
  );
  const somaDoBalcaoCentavos =
    somaveis.length >= 2 ? somaveis.reduce((s, a) => s + a.ganhoCentavos, 0) : null;

  return {
    prontas: ordenadas,
    semDado,
    custoIncompleto: motivosDoCustoIncompleto(linha.real),
    somaDoBalcaoCentavos,
  };
}

/** Frase do alto do painel. Diz o que falta quando nada rende, em vez de ficar em silêncio. */
export function fraseDoAltoDoPainel(p: PainelDeAlavancas): string {
  if (p.prontas.length === 0)
    return "Nenhuma alavanca com número para este preço. Veja abaixo o que falta para medir cada uma.";
  const n = p.prontas.length;
  return n === 1
    ? "Uma alavanca com número, ordenada pelo ganho em reais por unidade."
    : `${n} alavancas com número, da que mais rende para a que menos rende, em reais por unidade.`;
}

/** Texto do ganho de uma alavanca, em reais e em pontos de margem. */
export function textoDoGanho(a: Pick<AlavancaPronta, "ganhoCentavos" | "ganhoPontos">): string {
  return `Ganho de ${reaisPorExtenso(a.ganhoCentavos)} por unidade, ${pctTexto(a.ganhoPontos)} pontos de margem sobre o preço`;
}
