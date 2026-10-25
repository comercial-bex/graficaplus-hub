import { formatBRL } from "@/lib/produtos-catalogo";
import { planejarBobina } from "@/domain/producao/aproveitamento-bobina";
import {
  DECAPAGEM_MIN_POR_M2,
  tempoImpressao,
  tempoRecorte,
  type ComplexidadeDecapagem,
} from "@/domain/producao/tempo-de-maquina";
import { taxaDoPrazo } from "@/domain/parceiros/prazo";
import {
  BOBINAS,
  CASA,
  ESTOQUE_DE_ACABAMENTO,
  MAO_DE_OBRA,
  type BobinaDaCasa,
} from "./capacidade-da-casa";
import {
  LIMIAR_DO_DESCONTO_M2,
  PRECO_DO_PARCEIRO_NO_SISTEMA,
  precoDoM2,
  produtoDaTabela,
  type MaterialDaCasa,
  type ProdutoDaTabela,
} from "./tabela-terceirizados";

/**
 * O cliente no balcão (e o parceiro na tela) fazendo um pedido: quanto custa,
 * quanto tempo de MÁQUINA e de MÃO DE OBRA pede, se há material, e se dá para
 * fazer em expresso. É uma SIMULAÇÃO para achar problema antes de ele aparecer:
 * usa as contas que o sistema já tem (`planejarBobina`, `tempoImpressao`,
 * `tempoRecorte`, `taxaDoPrazo`) sobre os dados da casa (`capacidade-da-casa.ts`).
 *
 * Expresso = mais rápido, não mágico: a máquina pode ser priorizada, mas a mão de
 * obra não se comprime. Se o que manda no tempo é a mão de obra (decapagem de
 * recorte detalhado, bainha e ilhós de muitos metros), a simulação NÃO oferece
 * expresso, mesmo que o total coubra na janela por pouco.
 */

export type ItemDoBalcao = {
  produto: string;
  larguraM: number;
  alturaM: number;
  quantidade: number;
  /** só para adesivo com recorte */
  complexidade?: ComplexidadeDecapagem;
  /** lona e banner levam acabamento por padrão; "nenhum" tira (cliente leva só a impressão) */
  acabamento?: "padrao" | "nenhum";
};

export type OpcoesDoPedido = {
  prazo?: "normal" | "expresso";
  /** minutos de trabalho que já estão na frente deste pedido */
  filaMin?: number;
  /** a regra "acima de 6 m²" vale por linha (padrão) ou somando as linhas do MESMO produto */
  limiarPor?: "linha" | "produto";
  /** "progressiva" (padrão, regra decidida) ou "degrau" (desconto sobre a linha toda, só para comparar) */
  faixa?: "progressiva" | "degrau";
  taxaExpressoPct?: number;
  /**
   * "abastecido" (padrão) = a simulação não esbarra no estoque: o consumo sai no resultado e
   * é ele que diz quanto estoque a casa precisa ter. "real" = confronta com o estoque do banco
   * hoje, só para conferir o que falta agora.
   */
  estoque?: "real" | "abastecido";
  operadores?: number;
  janelaExpressoMin?: number;
};

export type Aviso = { codigo: string; mensagem: string; item?: number };

export type LinhaSimulada = {
  indice: number;
  produto: ProdutoDaTabela;
  areaPecaM2: number;
  areaCobradaM2: number;
  precoM2: number;
  valor: number;
  /** quando o preço de tabela é "a partir de", o valor é só o piso */
  valorEhPiso: boolean;
  /** a peça cabe inteira na largura do rolo (girada ou não) */
  cabeNaBobina: boolean;
  /** maior que o rolo: sai em painéis com emenda */
  paineis: number;
  emendaM: number;
  m2DeMaterial: number;
  impressaoMin: number;
  recorteMin: number;
  maoDeObraMin: number;
};

export type ResultadoDoPedido = {
  linhas: LinhaSimulada[];
  areaM2: number;
  produtos: number;
  taxaExpresso: number;
  total: number;
  tempos: {
    filaMin: number;
    impressaoMin: number;
    recorteMin: number;
    maoDeObraMin: number;
    maoDeObraRelogioMin: number;
    totalRelogioMin: number;
    gargalo: "maquina" | "mao_de_obra";
  };
  material: { consumoM2: Partial<Record<MaterialDaCasa, number>>; faltas: string[] };
  expresso: { possivel: boolean; motivos: string[]; folgaMin: number };
  avisos: Aviso[];
};

const arred = (n: number, casas = 2) => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

const ehLonaOuBanner = (p: ProdutoDaTabela) => p.familia === "lona" || p.familia === "banner";

export function simularPedido(
  itens: ItemDoBalcao[],
  opcoes: OpcoesDoPedido = {},
): ResultadoDoPedido {
  const prazo = opcoes.prazo ?? "normal";
  const operadores = Math.max(1, opcoes.operadores ?? CASA.operadores);
  const janela = opcoes.janelaExpressoMin ?? CASA.janelaExpressoMin;
  const avisos: Aviso[] = [];

  const linhasBase = itens.map((it, indice) => {
    const produto = produtoDaTabela(it.produto);
    const areaPecaM2 = arred(it.larguraM * it.alturaM, 4);
    // Área mínima do cadastro: peça pequena é cobrada como se tivesse o mínimo.
    const areaCobradaPeca = Math.max(areaPecaM2, produto.areaMinimaM2 ?? 0);
    if (produto.areaMinimaM2 && areaPecaM2 < produto.areaMinimaM2) {
      avisos.push({
        codigo: "area_minima_do_cadastro",
        mensagem: `${produto.nome} ${it.larguraM}×${it.alturaM} m (${areaPecaM2} m²): o cadastro do sistema cobra no mínimo ${produto.areaMinimaM2} m² por peça, a tabela do WhatsApp não fala em mínimo.`,
        item: indice,
      });
    }
    return {
      it,
      indice,
      produto,
      areaPecaM2,
      areaLinhaM2: arred(areaCobradaPeca * it.quantidade, 4),
      areaImpressaM2: arred(areaPecaM2 * it.quantidade, 4),
    };
  });

  // área que decide o "acima de 6 m²"
  const areaDoProduto = new Map<string, number>();
  for (const l of linhasBase)
    areaDoProduto.set(l.produto.chave, (areaDoProduto.get(l.produto.chave) ?? 0) + l.areaLinhaM2);

  const consumo: Partial<Record<MaterialDaCasa, number>> = {};
  let ilhosPrecisos = 0;
  let bastoesPrecisos = 0;
  let emendaLonaM = 0;
  let emendaVinilM = 0;
  const linhas: LinhaSimulada[] = linhasBase.map(
    ({ it, indice, produto, areaPecaM2, areaLinhaM2, areaImpressaM2 }) => {
      const areaParaFaixa =
        opcoes.limiarPor === "produto"
          ? (areaDoProduto.get(produto.chave) ?? areaLinhaM2)
          : areaLinhaM2;
      // Regra decidida: faixa progressiva por linha (a mesma do banco). "degrau" mostra a regra antiga.
      const degrau = opcoes.faixa === "degrau";
      const precoM2 = degrau
        ? precoDoM2(produto, areaParaFaixa)
        : areaLinhaM2 > 0
          ? valorProgressivo(produto, areaLinhaM2) / areaLinhaM2
          : produto.precoM2;
      const valor = degrau ? arred(areaLinhaM2 * precoM2) : valorProgressivo(produto, areaLinhaM2);

      if (produto.aPartirDe) {
        avisos.push({
          codigo: "preco_a_partir_de",
          mensagem: `${produto.nome}: a tabela diz "a partir de ${formatBRL(produto.precoM2)}/m²"; sem o preço fechado o orçamento sai pelo piso.`,
          item: indice,
        });
      }
      if (it.quantidade <= 0 || it.larguraM <= 0 || it.alturaM <= 0) {
        avisos.push({
          codigo: "medida_invalida",
          mensagem: "Medida ou quantidade inválida.",
          item: indice,
        });
      }

      // — material e layout na bobina —
      const bobina: BobinaDaCasa = BOBINAS[produto.material];
      let cabeNaBobina = false;
      let m2DeMaterial = 0;
      let paineis = 1;
      let emendaM = 0;
      // Material sem cadastro não trava a simulação: assume o rolo comum da família e avisa.
      const larguraBobina = bobina.larguraM ?? (produto.familia === "adesivo" ? 1.06 : 1.6);
      if (bobina.larguraM === null) {
        avisos.push({
          codigo: "material_nao_cadastrado",
          mensagem: `${produto.nome}: o material (${bobina.nome}) não está cadastrado; simulado com rolo de ${larguraBobina} m. Sem cadastro não há como reservar nem comprar pelo sistema.`,
          item: indice,
        });
      }
      {
        const plano = planejarBobina({
          larguraPeca: it.larguraM,
          alturaPeca: it.alturaM,
          quantidade: it.quantidade,
          larguraBobina,
          larguraUtilMaquina: CASA.impressao.larguraUtilM,
          margemLateral: CASA.impressao.margemLateralM,
          espacamento: produto.recorte ? 0.005 : 0.003,
          avancoM: CASA.impressao.avancoM,
        });
        if (plano.cabe) {
          cabeNaBobina = true;
          m2DeMaterial = plano.plano.m2Consumidos;
        } else {
          // Maior que o rolo: sai em painéis lado a lado, soldados (lona) ou alinhados (vinil).
          const util =
            Math.min(larguraBobina, CASA.impressao.larguraUtilM) -
            2 * CASA.impressao.margemLateralM;
          const menor = Math.min(it.larguraM, it.alturaM);
          const maior = Math.max(it.larguraM, it.alturaM);
          paineis = Math.max(2, Math.ceil(menor / util));
          emendaM = arred((paineis - 1) * maior * it.quantidade, 3);
          m2DeMaterial = arred(
            paineis * larguraBobina * (maior + CASA.impressao.avancoM) * it.quantidade,
            4,
          );
          if (produto.familia === "adesivo") emendaVinilM += emendaM;
          else emendaLonaM += emendaM;
          avisos.push({
            codigo: "precisa_de_emenda",
            mensagem: `${produto.nome} ${it.larguraM}×${it.alturaM} m passa da largura útil do rolo (${arred(util)} m): sai em ${paineis} painéis e ${emendaM} m de emenda.`,
            item: indice,
          });
        }
        consumo[produto.material] = arred((consumo[produto.material] ?? 0) + m2DeMaterial, 4);
      }

      // — tempos —
      const impressaoMin = tempoImpressao({
        areaM2: areaImpressaM2,
        velocidadeM2H: CASA.impressao.m2PorHora,
        setupMin: CASA.impressao.setupMin,
      }).minutos;

      let recorteMin = 0;
      let maoDeObraMin: number = MAO_DE_OBRA.preparoPorLinhaMin;
      if (produto.recorte) {
        const contornoM = arred(2 * (it.larguraM + it.alturaM) * it.quantidade, 3);
        const r = tempoRecorte({
          comprimentoCorteM: contornoM,
          velocidadeMmS: CASA.recorte.mmPorSegundo,
          areaM2: areaImpressaM2,
          complexidade: it.complexidade ?? "media",
        });
        recorteMin = r.minutosMaquina;
        // `tempoRecorte` decapa por m²; em peça pequena o que pesa é pegar peça por peça.
        const complexidade = it.complexidade ?? "media";
        const porPeca = it.quantidade * MAO_DE_OBRA.decapagemPorPecaMin[complexidade];
        const porArea = areaImpressaM2 * DECAPAGEM_MIN_POR_M2[complexidade];
        maoDeObraMin += r.minutosMaoDeObra + Math.max(0, porPeca - porArea);
      }
      if (ehLonaOuBanner(produto) && it.acabamento !== "nenhum") {
        if (produto.familia === "banner") {
          maoDeObraMin += MAO_DE_OBRA.bastaoECordaPorPecaMin * it.quantidade;
          bastoesPrecisos += it.quantidade;
        } else {
          const perimetroM = 2 * (it.larguraM + it.alturaM) * it.quantidade;
          maoDeObraMin += MAO_DE_OBRA.bainhaEIlhosPorMetroMin * perimetroM;
          ilhosPrecisos += Math.ceil(perimetroM * ESTOQUE_DE_ACABAMENTO.ilhosPorMetro);
        }
      }

      return {
        indice,
        produto,
        areaPecaM2,
        areaCobradaM2: areaLinhaM2,
        precoM2,
        valor,
        valorEhPiso: !!produto.aPartirDe,
        cabeNaBobina,
        paineis,
        emendaM,
        m2DeMaterial,
        impressaoMin: arred(impressaoMin),
        recorteMin: arred(recorteMin),
        maoDeObraMin: arred(maoDeObraMin),
      };
    },
  );

  // — estoque —
  const faltas: string[] = [];
  if (opcoes.estoque === "real") {
    for (const [material, m2] of Object.entries(consumo) as [MaterialDaCasa, number][]) {
      const b = BOBINAS[material];
      if (b.estoqueM2 !== null && m2 > b.estoqueM2) {
        faltas.push(`${b.nome}: precisa de ${arred(m2)} m² e há ${arred(b.estoqueM2)} m²`);
      }
    }
    if (ilhosPrecisos > ESTOQUE_DE_ACABAMENTO.ilhosUn) {
      faltas.push(`Ilhós: precisa de ${ilhosPrecisos} e há ${ESTOQUE_DE_ACABAMENTO.ilhosUn}`);
    }
    if (bastoesPrecisos > ESTOQUE_DE_ACABAMENTO.bastaoECordaUn) {
      faltas.push(
        `Bastão + corda: precisa de ${bastoesPrecisos} e há ${ESTOQUE_DE_ACABAMENTO.bastaoECordaUn}`,
      );
    }
  }
  for (const f of faltas) avisos.push({ codigo: "falta_de_material", mensagem: f });

  // — valores —
  const produtos = arred(linhas.reduce((s, l) => s + l.valor, 0));
  const pct = opcoes.taxaExpressoPct ?? 12;
  const taxaExpresso = prazo === "expresso" ? taxaDoPrazo(produtos, pct) : 0;
  const areaM2 = arred(
    linhasBase.reduce((s, l) => s + l.areaLinhaM2, 0),
    3,
  );

  // — tempo —
  const impressaoMin = arred(linhas.reduce((s, l) => s + l.impressaoMin, 0));
  const recorteMin = arred(linhas.reduce((s, l) => s + l.recorteMin, 0));
  const maoDeObraMin = arred(
    linhas.reduce((s, l) => s + l.maoDeObraMin, 0) +
      MAO_DE_OBRA.conferenciaEEmbalagemPorPedidoMin +
      emendaLonaM * MAO_DE_OBRA.emendaLonaPorMetroMin +
      emendaVinilM * MAO_DE_OBRA.emendaVinilPorMetroMin,
  );
  const maoDeObraRelogioMin = arred(maoDeObraMin / operadores);
  const filaMin = opcoes.filaMin ?? 0;
  const totalRelogioMin = arred(filaMin + impressaoMin + recorteMin + maoDeObraRelogioMin);
  const gargalo: "maquina" | "mao_de_obra" =
    impressaoMin + recorteMin >= maoDeObraRelogioMin ? "maquina" : "mao_de_obra";

  // — expresso —
  const motivos: string[] = [];
  if (faltas.length > 0) motivos.push("falta material no estoque");
  if (totalRelogioMin > janela) {
    motivos.push(
      `pede ${Math.round(totalRelogioMin)} min e a janela do expresso é de ${janela} min${filaMin > 0 ? ` (há ${filaMin} min de fila)` : ""}`,
    );
  }
  if (gargalo === "mao_de_obra" && maoDeObraRelogioMin > CASA.limiteMaoDeObraExpressoMin) {
    motivos.push("o que manda no tempo é mão de obra, e mão de obra não se acelera");
  }
  const possivel = motivos.length === 0;

  return {
    linhas,
    areaM2,
    produtos,
    taxaExpresso,
    total: arred(produtos + taxaExpresso),
    tempos: {
      filaMin,
      impressaoMin,
      recorteMin,
      maoDeObraMin,
      maoDeObraRelogioMin,
      totalRelogioMin,
      gargalo,
    },
    material: { consumoM2: consumo, faltas },
    expresso: { possivel, motivos, folgaMin: arred(janela - totalRelogioMin) },
    avisos: [...avisos, ...divergenciasComOSistema(linhas, opcoes.limiarPor)],
  };
}

/** Onde a tabela do WhatsApp e a do sistema discordam, para o produto do pedido. */
function divergenciasComOSistema(
  linhas: LinhaSimulada[],
  limiarPor?: "linha" | "produto",
): Aviso[] {
  const avisos: Aviso[] = [];
  const vistos = new Set<string>();
  for (const l of linhas) {
    if (vistos.has(l.produto.chave)) continue;
    vistos.add(l.produto.chave);
    if (l.produto.noCatalogo === null) {
      avisos.push({
        codigo: "produto_fora_do_catalogo",
        mensagem: `${l.produto.nome} está na tabela do WhatsApp e não existe no catálogo do sistema: o parceiro não consegue orçar nem pedir por ele.`,
        item: l.indice,
      });
      continue;
    }
    const noSistema = PRECO_DO_PARCEIRO_NO_SISTEMA[l.produto.noCatalogo];
    if (noSistema !== undefined && Math.abs(noSistema - l.produto.precoM2) >= 0.01) {
      avisos.push({
        codigo: "preco_diferente_do_sistema",
        mensagem: `${l.produto.nome}: a tabela diz ${formatBRL(l.produto.precoM2)}/m² e o sistema cobra do parceiro ${formatBRL(noSistema)}/m² (${l.produto.noCatalogo}).`,
        item: l.indice,
      });
    }
  }
  void limiarPor;
  return avisos;
}

/**
 * O degrau da tabela: "acima de 6 m²" faz o preço do m² CAIR para a linha inteira, então
 * um pedido de 6,02 m² sai mais barato que um de 6,00 m². Devolve, para cada produto com
 * essa faixa, quanto o pedido mais barato custa a menos que o pedido logo abaixo do limiar.
 */
export function degrauDePreco(p: ProdutoDaTabela): {
  deArea: number;
  paraArea: number;
  valorAntes: number;
  valorDepois: number;
  queda: number;
} | null {
  if (p.precoM2Acima === undefined) return null;
  const antes = arred(LIMIAR_DO_DESCONTO_M2 * precoDoM2(p, LIMIAR_DO_DESCONTO_M2));
  const depoisArea = arred(LIMIAR_DO_DESCONTO_M2 + 0.01, 2);
  const depois = arred(depoisArea * precoDoM2(p, depoisArea));
  return {
    deArea: LIMIAR_DO_DESCONTO_M2,
    paraArea: depoisArea,
    valorAntes: antes,
    valorDepois: depois,
    queda: arred(antes - depois),
  };
}

/**
 * A alternativa sem degrau: os primeiros 6 m² saem ao preço cheio e só o que passa de 6 m² ao
 * preço menor. O pedido maior nunca custa menos que o menor, e o cliente que passa de 6 m²
 * continua pagando menos por m² no fim.
 */
export function valorProgressivo(p: ProdutoDaTabela, areaM2: number): number {
  if (p.precoM2Acima === undefined) return arred(areaM2 * p.precoM2);
  const ate = Math.min(areaM2, LIMIAR_DO_DESCONTO_M2);
  const acima = Math.max(0, areaM2 - LIMIAR_DO_DESCONTO_M2);
  return arred(ate * p.precoM2 + acima * p.precoM2Acima);
}
