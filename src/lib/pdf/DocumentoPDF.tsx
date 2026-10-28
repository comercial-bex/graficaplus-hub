import type { ComponentProps, ReactNode } from "react";
import { Document, Page, Text as TextoPDF, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { Empresa } from "./empresa";
import { rotuloDoDocumento } from "@/domain/documentos";
import {
  dataBR,
  dinheiro,
  metros,
  metrosQuadrados,
  quantidadeBR,
  unidadeNoDocumento,
} from "./formato";

/**
 * O documento da gráfica — orçamento, OS, fatura, recibo de material e
 * orçamento 3D — num visual só, para a marca ser uma.
 *
 * A estrutura é a do modelo que a operação já usava (orçamento 1059): os
 * mesmos blocos, os mesmos rótulos, na mesma ordem. O desenho é o da
 * referência que o dono mandou em 27/10/2026 (o 142 redesenhado): barras de
 * seção escuras com o título em branco, o número do documento numa caixa da cor
 * da marca, a faixa magenta · verde · ciano da logo separando cabeçalho e
 * rodapé, os itens numerados em círculos coloridos, e — a diferença que mais
 * pesa — o bloco LAYOUT em CARTÕES grandes, um por item, com o nome do item na
 * barra e a arte ocupando o cartão (as margens brancas da arte já vêm tiradas
 * por `imagens.ts`). Pagamento e observação ficam lado a lado, com o valor em
 * destaque; o rodapé é uma barra escura com endereço, telefone e e-mail.
 *
 * As cores vêm de `empresa` (cor da marca, faixa, logo do rodapé): o documento
 * do parceiro passa pelo mesmo desenho com a cor DELE e sem faixa nem logo da
 * Bex Print — nada da gráfica entra na folha dele.
 *
 * Este módulo puxa o @react-pdf inteiro: entra só por `import()` no navegador
 * (ver `renderPDFBlob`). Quem precisa dos tipos usa `import type` — importar o
 * componente direto numa rota leva a biblioteca para o pacote do servidor.
 */

export type DocItem = {
  codigo?: string | number;
  /** Nome do que se vende — sai em negrito. */
  descricao: string;
  /** Detalhes de produção (material, cores, frente/verso…) — sai menor, embaixo da descrição. */
  especificacao?: string | null;
  unidade?: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  /** metros */
  largura?: number | null;
  altura?: number | null;
  /** m², já calculada no banco (coluna gerada) */
  area_total?: number | null;
  acabamento?: string | null;
  tipo_produto?: string | null;
  /**
   * Capa da arte do item (cartão do bloco LAYOUT). `renderPDFBlob` troca a URL
   * por um data URL JPEG/PNG antes de desenhar, já sem as margens lisas
   * (imagens.ts); quando não dá, marca `layout_sem_previa` e o cartão mostra o
   * nome do arquivo.
   */
  layout_url?: string | null;
  /** Nome do arquivo da capa, para a caixa "arte sem prévia: nome.ext". */
  layout_nome?: string | null;
  layout_sem_previa?: boolean;
  /** Quantas artes o item tem além da capa ("+N" no cartão). */
  layouts_extras?: number;
};

export type ParcelaDoDocumento = {
  numero: number;
  valor: number;
  /** "aaaa-mm-dd" */
  vencimento: string | null;
  /** Só a fatura sabe: parcela já recebida. */
  pago?: boolean;
};

export type DocumentoPDFProps = {
  tipo: "orcamento" | "os" | "orcamento_3d" | "recibo_material" | "fatura";
  numero: number | string;
  /** Datas do cabeçalho e do rodapé já em dd/mm/aaaa. */
  data_solicitacao?: string | null;
  data_validade?: string | null;
  data_entrega?: string | null;
  data_expedicao?: string | null;
  vendedor?: string | null;
  status?: string | null;
  empresa: Empresa;
  cliente: {
    nome: string;
    razao_social?: string | null;
    nome_fantasia?: string | null;
    documento?: string | null;
    inscricao_estadual?: string | null;
    endereco?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
    telefone?: string | null;
    celular?: string | null;
    email?: string | null;
    contato?: string | null;
  };
  itens: DocItem[];
  /** soma de area_total dos itens, em m² */
  soma_area?: number | null;
  subtotal?: number | null;
  desconto?: number | null;
  total: number;
  /** Forma e número de parcelas (`condicao_pagamento`). */
  pagamento?: { forma?: string | null; parcelas?: number | null } | null;
  /**
   * Parcelas com valor e vencimento. No orçamento, a conta da conversão em OS;
   * na fatura, as parcelas reais com a situação de cada uma. Sem as datas o
   * cliente liga para perguntar quando vence — o telefonema que o documento
   * existe para evitar.
   */
  parcelas?: ParcelaDoDocumento[] | null;
  /** Texto da caixa ENDEREÇO: ENTREGA ("Cliente retira na empresa" ou o endereço). */
  entrega?: string | null;
  /** Observação ao cliente. No orçamento sem ela entram as condições gerais da empresa. */
  observacoes?: string | null;
  /** Só na via de produção: o recado da venda para a oficina. */
  observacao_interna?: string | null;
  /** Já recebido, para a fatura mostrar o saldo em aberto e não o total cheio. */
  valor_pago?: number | null;
  /**
   * Rótulos das duas linhas de assinatura. Sem isso o documento assume
   * "responsável × cliente", que é o par certo para OS e errado para um recibo
   * de retirada — ali quem assina é o almoxarifado e quem levou o material.
   */
  assinaturas?: { esquerda: string; direita: string } | null;
  mostrarValores?: boolean;
  /**
   * Quebra de custo para a via INTERNA — nunca sai no documento do cliente nem
   * na via de produção.
   *
   * Existe porque quem forma preço precisa ver, na mesma folha que o cliente
   * assina, com que números o preço foi montado: a tarifa de energia daquele
   * dia, a hora de mão de obra, o custo do material. Sem isso, conferir um
   * orçamento antigo vira arqueologia.
   */
  custos?: {
    tarifas?: { rotulo: string; valor: string }[];
    itens?: {
      descricao: string;
      quantidade: number;
      custo_previsto_unitario: number;
      custo_real_unitario: number | null;
      custo_perda: number | null;
      preco_unitario: number;
      margem_real: number | null;
    }[];
  } | null;
};

/** O texto que o orçamento leva quando nem ele nem a empresa têm observação. */
const CONDICOES_PADRAO_DA_GRAFICA = `1 — Os layouts a serem produzidos deverão ser entregues até 03 (três) dias úteis antes do início da data de exibição, mediante assinatura do pedido, aprovação da arte e comprovação de pagamento.
2 — Favor conferir os dados cadastrais para emissão de documento fiscal.`;

/**
 * Texto que só hifeniza quando a palavra não cabe na coluna.
 *
 * O @react-pdf hifeniza com regras do inglês para encher a linha — "estrutu-ra"
 * numa descrição que tinha espaço de sobra. Com a penalidade alta a quebra fica
 * nos espaços, e o hífen só aparece onde a palavra sozinha é mais larga que a
 * coluna ("Comuni-cação" no Tipo Produto), em vez de vazar para a vizinha.
 * (`hyphenationPenalty` existe no @react-pdf 4, mas não nos tipos dele.)
 */
function Text(props: ComponentProps<typeof TextoPDF>) {
  return <TextoPDF {...({ hyphenationPenalty: 5000 } as object)} {...props} />;
}

/** Um estilo do @react-pdf (o tipo não é exportado pelo renderer; vem do próprio View). */
type Estilo = Exclude<ComponentProps<typeof View>["style"], undefined | unknown[]>;

/** `maxLines` existe no @react-pdf 4 (corta com reticências), mas não nos tipos dele. */
const UMA_LINHA = { maxLines: 1 } as object;

/* ------------------------------------------------------------------------- */
/* Cores                                                                      */
/* ------------------------------------------------------------------------- */

const PRETO = "#111111";
/** Barras de seção e rodapé: o "escuro" da referência, que não é preto chapado. */
const ESCURO = "#1f2a3c";
const CINZA_TEXTO = "#4b5563";
const BORDA = "#c9d1dc";
const FUNDO_TABELA = "#eef2f7";
const BRANCO = "#ffffff";

const COR_VALIDA = /^#[0-9a-fA-F]{6}$/;

/** Mistura a cor com branco: 0 = a cor, 1 = branco. Para o fundo das pílulas. */
function clarear(hex: string, fator: number): string {
  if (!COR_VALIDA.test(hex)) return "#e5e7eb";
  const canal = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * fator)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${canal(1)}${canal(3)}${canal(5)}`;
}

/* ------------------------------------------------------------------------- */
/* Medidas (pt; A4 = 595 × 842)                                               */
/* ------------------------------------------------------------------------- */

const LINHA = 0.75;
const RAIO = 5;
const MARGEM = 28.5;
/** Recuo interno das seções, onde começa o texto. */
const RECUO = 6;
const LARGURA_PAGINA = 595.28;
const LARGURA_CONTEUDO = LARGURA_PAGINA - 2 * MARGEM;
const LARGURA_UTIL = LARGURA_CONTEUDO - 2 * RECUO;
/** Altura da área da arte no cartão de layout: dois cartões por linha, a arte do tamanho de um selo postal grande. */
const ALTURA_DA_ARTE = 150;
/** A faixa da marca entre cabeçalho e corpo, e entre corpo e rodapé. */
const ALTURA_DA_FAIXA = 3.5;
/** O que o rodapé fixo ocupa: a página reserva isso embaixo. */
const ALTURA_DO_RODAPE = 62;

const s = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingBottom: ALTURA_DO_RODAPE + 16,
    paddingHorizontal: MARGEM,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: PRETO,
    // Sem lineHeight aqui: na página ele some com o rodapé `fixed` (o
    // @react-pdf deixa de desenhar o bloco absoluto). A altura natural da
    // Helvetica, ~1,15, é a do modelo.
  },
  negrito: { fontFamily: "Helvetica-Bold" },

  // cabeçalho
  cabecalho: { flexDirection: "row", alignItems: "flex-start", minHeight: 88 },
  logo: { width: 150, height: 80, objectFit: "contain", objectPositionX: 0 },
  logoCaixa: {
    width: 150,
    height: 84,
    borderWidth: LINHA,
    borderRadius: RAIO,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  logoNome: { fontFamily: "Helvetica-Bold", fontSize: 15, textAlign: "center" },
  logoSlogan: { fontSize: 7, textAlign: "center", marginTop: 5, color: "#333333" },
  // lineHeight sem unidade multiplica o fontSize do MESMO estilo (ou 18, se não
  // houver): sem o fontSize aqui as linhas do emissor saíam com 22 pt de altura.
  emissor: { flex: 1, paddingLeft: 22, paddingRight: 10, paddingTop: 6, fontSize: 9, lineHeight: 1.3 },
  numeroCol: { width: 176, alignItems: "stretch", paddingTop: 4 },
  numeroCaixa: {
    borderRadius: RAIO,
    paddingHorizontal: 8,
    paddingTop: 5,
    paddingBottom: 4,
  },
  numeroTexto: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: BRANCO,
    textAlign: "left",
  },
  clienteNoCabecalho: { marginTop: 6, paddingLeft: 1 },
  clienteNoCabecalhoLinha: { marginTop: 1.8 },
  marcaVia: {
    marginTop: 5,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    borderWidth: LINHA,
    borderColor: PRETO,
    paddingHorizontal: 5,
    paddingTop: 2,
    paddingBottom: 1,
    alignSelf: "flex-start",
  },
  situacao: { marginTop: 4, fontSize: 8 },

  faixa: { flexDirection: "row", height: ALTURA_DA_FAIXA, marginTop: 6 },
  faixaTrecho: { flex: 1 },

  datas: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, marginBottom: 2 },

  // seções: barra escura com título + corpo com borda clara
  secao: {
    marginTop: 7,
    borderWidth: LINHA,
    borderColor: BORDA,
    borderRadius: RAIO,
  },
  barra: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ESCURO,
    borderTopLeftRadius: RAIO - 1,
    borderTopRightRadius: RAIO - 1,
    paddingHorizontal: RECUO + 2,
    paddingTop: 3.5,
    paddingBottom: 2.5,
    minHeight: 15,
  },
  barraTitulo: { fontFamily: "Helvetica-Bold", fontSize: 9, color: BRANCO, letterSpacing: 0.4 },
  corpo: { paddingHorizontal: RECUO, paddingTop: 5, paddingBottom: 6 },
  corpoSemRecuo: { paddingTop: 0, paddingBottom: 0, paddingHorizontal: 0 },
  // lineHeight sem unidade multiplica o fontSize DO MESMO estilo (ou 18, se não
  // houver): por isso os dois andam juntos aqui.
  textoCaixa: { fontSize: 9, lineHeight: 1.35 },
  /** Condições gerais (texto padrão da empresa): letra menor, é o miúdo do contrato. */
  textoCondicoes: { fontSize: 8, lineHeight: 1.4 },

  // cliente (OS, fatura, recibo)
  caixaCliente: { paddingTop: 1, paddingBottom: 1 },
  clienteLinha: { flexDirection: "row", paddingVertical: 1.2 },
  clienteGrupo: { marginTop: 1 },
  clienteCel: { width: "50%", paddingLeft: 2.2, paddingRight: 6 },

  // tabela de itens
  cabecalhoTabela: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: FUNDO_TABELA,
    borderBottomWidth: LINHA,
    borderBottomColor: BORDA,
    paddingHorizontal: RECUO,
    paddingTop: 4,
    paddingBottom: 3,
  },
  linhaItem: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: LINHA,
    borderBottomColor: BORDA,
    paddingHorizontal: RECUO,
    paddingVertical: 1.5,
    minHeight: 26,
  },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  // Círculo + descrição num bloco só: o círculo fica na altura da 1ª linha
  // mesmo quando a especificação acrescenta outras embaixo.
  cDados: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 2 },
  cNumero: { width: 16, paddingTop: 0.2, alignItems: "flex-start" },
  cTipo: { width: 46, paddingRight: 3 },
  cAcabamento: { width: 70, paddingRight: 4 },
  cQtd: { width: 72, paddingRight: 3 },
  cValor: { width: 60, textAlign: "right", paddingRight: 2 },
  cTotal: { width: 76, textAlign: "right" },
  unidade: { fontSize: 6.5 },
  especificacao: { fontSize: 7.5, marginTop: 1.5, color: "#262626", lineHeight: 1.25 },
  metragem: { fontSize: 7.5, lineHeight: 1.2 },
  resumoItens: {
    paddingHorizontal: RECUO,
    paddingTop: 3.5,
    paddingBottom: 3,
    borderBottomLeftRadius: RAIO - 1,
    borderBottomRightRadius: RAIO - 1,
  },

  // O número do item num círculo cheio da cor da marca; com dois dígitos vira pílula.
  circulo: {
    minWidth: 11.5,
    height: 11.5,
    borderRadius: 5.75,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 1.5,
  },
  circuloTexto: {
    fontSize: 7,
    lineHeight: 1,
    textAlign: "center",
    marginTop: 0.4,
    color: BRANCO,
    fontFamily: "Helvetica-Bold",
  },

  // cartões de layout
  cartoes: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingTop: 2,
  },
  cartao: {
    width: "49.2%",
    marginBottom: 7,
    borderWidth: LINHA,
    borderColor: BORDA,
    borderRadius: RAIO,
    position: "relative",
  },
  cartaoTopo: {
    flexDirection: "row",
    alignItems: "center",
    borderTopLeftRadius: RAIO - 1,
    borderTopRightRadius: RAIO - 1,
    paddingHorizontal: 6,
    paddingTop: 3.5,
    paddingBottom: 3,
  },
  cartaoCirculo: {
    minWidth: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: BRANCO,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 5,
    paddingHorizontal: 1.5,
  },
  cartaoCirculoTexto: {
    fontSize: 7.5,
    lineHeight: 1,
    textAlign: "center",
    marginTop: 0.8,
    fontFamily: "Helvetica-Bold",
  },
  cartaoTitulo: { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 9, color: BRANCO },
  cartaoArte: {
    height: ALTURA_DA_ARTE,
    alignItems: "center",
    justifyContent: "center",
    padding: 5,
    backgroundColor: BRANCO,
    borderBottomLeftRadius: RAIO - 1,
    borderBottomRightRadius: RAIO - 1,
  },
  cartaoImagem: { width: "100%", height: ALTURA_DA_ARTE - 10, objectFit: "contain" },
  cartaoSemPrevia: {
    width: "90%",
    height: ALTURA_DA_ARTE - 24,
    borderWidth: LINHA,
    borderColor: BORDA,
    borderStyle: "dashed",
    borderRadius: RAIO,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  cartaoSemPreviaTexto: { fontSize: 7.5, textAlign: "center", color: CINZA_TEXTO, lineHeight: 1.3 },
  cartaoExtras: {
    position: "absolute",
    bottom: 5,
    right: 5,
    backgroundColor: BRANCO,
    borderWidth: LINHA,
    borderColor: ESCURO,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingTop: 1.5,
    paddingBottom: 0.6,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
  },

  // entrega + totais
  blocoBarra: { flexDirection: "row", alignItems: "stretch" },
  abaDesconto: {
    justifyContent: "center",
    paddingHorizontal: 9,
    paddingTop: 3.5,
    paddingBottom: 2.5,
    borderTopRightRadius: RAIO - 1,
  },
  abaDescontoTexto: { fontFamily: "Helvetica-Bold", fontSize: 8.5, color: BRANCO },
  blocoCorpo: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: RECUO, paddingTop: 5, paddingBottom: 5 },
  entregaTexto: { flex: 1, paddingRight: 10, fontSize: 9, lineHeight: 1.35, paddingTop: 1 },
  totais: { alignItems: "flex-end" },
  totalLinha: { marginTop: 2 },
  totalTexto: { fontFamily: "Helvetica-Bold", fontSize: 9.5 },
  totaisSoltos: { alignItems: "flex-end", marginTop: 6, marginBottom: 2, paddingRight: 2 },

  // pagamento e observação lado a lado
  duasColunas: { flexDirection: "row", alignItems: "stretch" },
  colunaPagamento: { width: "36%", marginRight: 7 },
  colunaLarga: { flex: 1 },
  pilula: {
    alignSelf: "flex-start",
    marginTop: 5,
    borderWidth: LINHA,
    borderRadius: RAIO,
    paddingHorizontal: 9,
    paddingTop: 4,
    paddingBottom: 3,
  },
  pilulaTexto: { fontFamily: "Helvetica-Bold", fontSize: 10.5 },
  parcelasLista: { marginTop: 4 },
  parcela: { fontSize: 8.5, lineHeight: 1.45 },
  pagamentoLinha: { marginTop: 2.5 },

  // fecho
  responsavel: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 7,
    paddingHorizontal: 1,
  },
  prazos: { alignItems: "flex-end" },
  validade: { marginTop: 4, paddingHorizontal: 1 },
  aceite: { marginTop: 14, alignItems: "center" },
  aceiteTexto: { textAlign: "center" },
  assinaturaLinha: { marginTop: 22, width: 270, borderTopWidth: LINHA, borderTopColor: PRETO },
  assinaturaRotulo: { marginTop: 7, textAlign: "center" },
  assinaturas: {
    flexDirection: "row",
    marginTop: 30,
    justifyContent: "space-between",
    paddingHorizontal: 10,
  },
  assinatura: {
    width: "44%",
    borderTopWidth: LINHA,
    borderTopColor: PRETO,
    paddingTop: 4,
    alignItems: "center",
  },
  assinaturaTexto: { fontSize: 8, textAlign: "center" },

  // rodapé fixo: faixa + barra escura de contato + linha da página
  rodape: { position: "absolute", bottom: 10, left: MARGEM, right: MARGEM },
  rodapeFaixa: { flexDirection: "row", height: ALTURA_DA_FAIXA },
  rodapeBarra: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ESCURO,
    borderBottomLeftRadius: RAIO,
    borderBottomRightRadius: RAIO,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 36,
  },
  // O endereço é o contato mais comprido: leva quase o dobro da coluna do
  // telefone, senão "Perpétuo Socorro" sai hifenizado.
  rodapeContato: { flex: 1, paddingRight: 8 },
  rodapeEndereco: { flex: 1.9 },
  rodapeTelefone: { flex: 0.9 },
  rodapeEmail: { flex: 1.3 },
  rodapeRotulo: { fontFamily: "Helvetica-Bold", fontSize: 6.3, letterSpacing: 0.6, marginBottom: 1.5 },
  rodapeTexto: { fontSize: 7.5, color: BRANCO, lineHeight: 1.25 },
  rodapeLogo: { width: 72, height: 30, objectFit: "contain", objectPositionX: 1 },
  rodapePagina: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 3,
    fontSize: 6.8,
    color: CINZA_TEXTO,
  },
});

const TITULO: Record<DocumentoPDFProps["tipo"], string> = {
  orcamento: "Orçamento",
  orcamento_3d: "Orçamento 3D",
  os: "Ordem de Serviço",
  fatura: "Fatura",
  recibo_material: "Recibo de Retirada de Material",
};

const ROTULO_DO_TOTAL: Record<DocumentoPDFProps["tipo"], string> = {
  orcamento: "Valor Total do Orçamento",
  orcamento_3d: "Valor Total do Orçamento",
  os: "Valor Total da OS",
  fatura: "Valor Total da Fatura",
  recibo_material: "Valor Total",
};

/** "Rótulo: valor" com o rótulo em negrito, como em todo o modelo. */
function Campo({ rotulo, valor }: { rotulo: string; valor?: string | number | null }) {
  return (
    <Text>
      <Text style={s.negrito}>{rotulo}: </Text>
      {valor == null ? "" : String(valor)}
    </Text>
  );
}

/** A faixa da marca: um trecho por cor, da esquerda para a direita. */
function Faixa({ cores, estilo }: { cores: readonly string[]; estilo?: Estilo }) {
  return (
    <View style={estilo ? [s.faixa, estilo] : s.faixa}>
      {cores.map((cor, i) => (
        <View key={i} style={[s.faixaTrecho, { backgroundColor: cor }]} />
      ))}
    </View>
  );
}

/**
 * Seção do documento: barra escura com o título e o corpo com borda clara.
 * `direita` entra na barra, à direita do título (a aba do desconto).
 */
function Secao({
  titulo,
  children,
  inteira = true,
  semRecuo = false,
  estilo,
  direita,
}: {
  titulo: string;
  children?: ReactNode;
  /** false deixa a seção quebrar entre páginas (tabelas longas). */
  inteira?: boolean;
  /** Corpo sem recuo: a tabela desenha as próprias margens. */
  semRecuo?: boolean;
  estilo?: Estilo;
  direita?: ReactNode;
}) {
  return (
    <View style={estilo ? [s.secao, estilo] : s.secao} wrap={!inteira}>
      <View style={direita ? s.blocoBarra : undefined} minPresenceAhead={36}>
        <View style={direita ? [s.barra, { flex: 1, borderTopRightRadius: 0 }] : s.barra}>
          <Text style={s.barraTitulo}>{titulo}</Text>
        </View>
        {direita}
      </View>
      <View style={semRecuo ? [s.corpo, s.corpoSemRecuo] : s.corpo}>{children}</View>
    </View>
  );
}

/** O número do item num círculo cheio (na tabela). */
function Circulo({ n, cor }: { n: number; cor: string }) {
  return (
    <View style={[s.circulo, { backgroundColor: cor }, n >= 10 ? { paddingHorizontal: 2.5 } : {}]}>
      <Text style={n >= 10 ? [s.circuloTexto, { fontSize: 6.5 }] : s.circuloTexto}>{n}</Text>
    </View>
  );
}

const temTexto = (v: string | null | undefined): v is string => !!v && v.trim() !== "";

export function DocumentoPDF(p: DocumentoPDFProps) {
  const empresa = p.empresa;
  const ehOrcamento = p.tipo === "orcamento" || p.tipo === "orcamento_3d";
  const eh3d = p.tipo === "orcamento_3d";
  const ehRecibo = p.tipo === "recibo_material";
  const mostrar = (p.mostrarValores ?? true) && !ehRecibo;
  const titulo = TITULO[p.tipo];
  const viaDeProducao = !mostrar && !ehRecibo;
  const marcaDaVia = viaDeProducao ? "VIA DE PRODUÇÃO" : p.custos ? "USO INTERNO" : null;
  const identificacao = ehRecibo ? `${titulo} — OS Nº ${p.numero}` : `${titulo} Nº ${p.numero}`;

  // ------------------------------------------------------------------ cores
  const cor = COR_VALIDA.test(empresa.cor) ? empresa.cor : "#1f2a3c";
  // Sem faixa própria (parceiro), a faixa é a cor da marca dele, inteira.
  const faixa = empresa.faixa && empresa.faixa.length > 0 ? empresa.faixa : [cor];
  const corDoCartao = (i: number) => faixa[i % faixa.length];
  const corDaAba = faixa[0];
  const fundoClaro = clarear(cor, 0.84);

  // ---------------------------------------------------------------- emissor
  const linhasDoEmissor = [
    [empresa.endereco, empresa.bairro].filter(temTexto).join(", "),
    [empresa.cep, [empresa.cidade, empresa.estado].filter(temTexto).join(" - ")]
      .filter(temTexto)
      .join(" "),
    [
      empresa.cnpj ? `${rotuloDoDocumento(empresa.cnpj)}: ${empresa.cnpj}` : null,
      empresa.inscricao_estadual ? `IE: ${empresa.inscricao_estadual}` : null,
    ]
      .filter(temTexto)
      .join(" - "),
    empresa.telefones ? `Fone: ${empresa.telefones}` : null,
    empresa.email,
    empresa.site,
  ].filter(temTexto);

  // O rodapé repete o contato em três colunas: só as que existem.
  const contatos = [
    {
      rotulo: "ENDEREÇO",
      estilo: s.rodapeEndereco,
      valor: [
        [empresa.endereco, empresa.bairro].filter(temTexto).join(", "),
        [empresa.cidade, empresa.estado].filter(temTexto).join(" - "),
        empresa.cep,
      ]
        .filter(temTexto)
        .join(" · "),
    },
    { rotulo: "TELEFONE", estilo: s.rodapeTelefone, valor: empresa.telefones ?? "" },
    { rotulo: "E-MAIL", estilo: s.rodapeEmail, valor: empresa.email ?? "" },
  ].filter((c) => temTexto(c.valor));
  const temRodape = contatos.length > 0 || temTexto(empresa.logo_escura_url);

  // ------------------------------------------------------------------ itens
  // A coluna de dados (círculo + descrição) fica com o que sobra das outras.
  const larguraDados = LARGURA_UTIL - (ehRecibo ? 0 : 46) - 70 - 72 - (mostrar ? 60 + 76 : 0);
  const layouts = p.itens
    .map((item, indice) => ({ item, numero: indice + 1 }))
    .filter((l) => !!l.item.layout_url || !!l.item.layout_sem_previa);
  const temArea = (p.soma_area ?? 0) > 0;
  const subtotal = Number(p.subtotal ?? p.total);
  const desconto = Math.max(0, Number(p.desconto ?? 0));

  // -------------------------------------------------------------- pagamento
  const parcelas = p.parcelas ?? [];
  const nParcelas = p.pagamento?.parcelas ?? (parcelas.length || null);
  const mostrarPagamento = mostrar && (!!p.pagamento || parcelas.length > 0);
  const umaSoParcelaSemData = parcelas.length === 1 && !parcelas[0].vencimento && !parcelas[0].pago;

  // ------------------------------------------------------------ observações
  // No orçamento do cliente a caixa nunca sai vazia: sem observação própria
  // entram as condições gerais da empresa (ou o texto padrão), em letra menor.
  const condicoesGerais = ehOrcamento && mostrar && !temTexto(p.observacoes);
  const observacao = temTexto(p.observacoes)
    ? p.observacoes
    : condicoesGerais
      ? (empresa.condicoes_gerais ?? CONDICOES_PADRAO_DA_GRAFICA)
      : null;

  const temEntrega = temTexto(p.entrega);
  const cidadeDoCliente = [p.cliente.cidade, p.cliente.estado].filter(temTexto).join(" - ");
  const rotuloDocCliente = rotuloDoDocumento(p.cliente.documento);

  const totais = mostrar ? (
    <View style={s.totais}>
      <Text style={s.totalTexto}>
        {ROTULO_DO_TOTAL[p.tipo]}: {dinheiro(p.total)}
      </Text>
      {/* Na fatura o que interessa é o saldo, não o total: o cliente que já
          pagou a entrada precisa ver quanto ainda deve. */}
      {p.valor_pago != null && p.valor_pago > 0 && (
        <>
          <Text style={s.totalLinha}>Já recebido: {dinheiro(p.valor_pago)}</Text>
          <Text style={[s.negrito, s.totalLinha]}>
            Saldo em aberto: {dinheiro(p.total - p.valor_pago)}
          </Text>
        </>
      )}
    </View>
  ) : null;

  const abaDoDesconto = mostrar ? (
    <View style={[s.abaDesconto, { backgroundColor: corDaAba }]}>
      <Text style={s.abaDescontoTexto}>Valor Desconto: {dinheiro(desconto)}</Text>
    </View>
  ) : undefined;

  return (
    <Document title={identificacao} author={empresa.razao_social ?? empresa.nome}>
      <Page size="A4" style={s.page}>
        {/* ------------------------------------------------ cabeçalho */}
        <View style={s.cabecalho}>
          {empresa.logo_url ? (
            <Image style={s.logo} src={empresa.logo_url} />
          ) : (
            <View style={[s.logoCaixa, { borderColor: cor }]}>
              <Text style={[s.logoNome, { color: cor }]}>{empresa.nome}</Text>
              {temTexto(empresa.slogan) && <Text style={s.logoSlogan}>{empresa.slogan}</Text>}
            </View>
          )}
          <View style={s.emissor}>
            <Text style={s.negrito}>{empresa.razao_social ?? empresa.nome}</Text>
            {linhasDoEmissor.map((linha, i) => (
              <Text key={i}>{linha}</Text>
            ))}
          </View>
          <View style={s.numeroCol}>
            <View style={[s.numeroCaixa, { backgroundColor: cor }]}>
              {ehRecibo ? (
                <>
                  <Text style={s.numeroTexto}>{titulo}</Text>
                  <Text style={s.numeroTexto}>OS Nº {p.numero}</Text>
                </>
              ) : (
                <Text style={s.numeroTexto}>
                  {titulo}: Nº {p.numero}
                </Text>
              )}
            </View>
            {marcaDaVia && <Text style={s.marcaVia}>{marcaDaVia}</Text>}
            {temTexto(p.status) && (p.tipo === "os" || p.tipo === "fatura") && (
              <Text style={s.situacao}>Situação: {p.status}</Text>
            )}
            {/* Orçamento: o cliente vem DENTRO do cabeçalho, embaixo do número,
                só com os cinco dados que identificam quem compra — decisão do
                dono no Lovable em 06/10/2026 ("Otimizou dados do cliente"). No
                modelo 1059 eram doze campos numa caixa depois das datas, quase
                todos em branco. OS, fatura e recibo mantêm a caixa completa. */}
            {ehOrcamento && (
              <View style={s.clienteNoCabecalho}>
                {(
                  [
                    ["Razão Social", p.cliente.razao_social || p.cliente.nome],
                    [rotuloDocCliente, p.cliente.documento],
                    ["Endereço", p.cliente.endereco],
                    ["Telefone", p.cliente.telefone || p.cliente.celular],
                    ["Bairro", p.cliente.bairro],
                  ] as [string, string | null | undefined][]
                ).map(([rotulo, valor]) => (
                  <View key={rotulo} style={s.clienteNoCabecalhoLinha}>
                    <Campo rotulo={rotulo} valor={temTexto(valor) ? valor : "—"} />
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        <Faixa cores={faixa} />

        <View style={s.datas}>
          <Campo rotulo="Data de Emissão" valor={p.data_solicitacao ?? "—"} />
          {!ehOrcamento && (p.tipo === "os" || !!p.data_entrega) && (
            <Campo rotulo="Data de Entrega" valor={p.data_entrega ?? "—"} />
          )}
        </View>

        {/* -------------------------------------------------- cliente */}
        {!ehOrcamento && (
          <Secao titulo="CLIENTE">
            <View style={s.caixaCliente} wrap={false}>
              {(
                [
                  [
                    ["Razão Social", p.cliente.razao_social ?? p.cliente.nome],
                    ["Nome Fantasia", p.cliente.nome_fantasia],
                  ],
                  [
                    [rotuloDocCliente, p.cliente.documento],
                    ["Inscrição Estadual", p.cliente.inscricao_estadual],
                  ],
                  [
                    ["End.", p.cliente.endereco],
                    ["Bairro", p.cliente.bairro],
                  ],
                  [
                    ["CEP", p.cliente.cep],
                    ["Cidade", cidadeDoCliente],
                  ],
                  [
                    ["Telefone", p.cliente.telefone],
                    ["Celular", p.cliente.celular],
                  ],
                  [
                    ["E-mail", p.cliente.email],
                    ["Contato", p.cliente.contato],
                  ],
                ] as [string, string | null | undefined][][]
              ).map((linha, i) => (
                <View
                  key={i}
                  style={i === 2 || i === 4 ? [s.clienteLinha, s.clienteGrupo] : s.clienteLinha}
                >
                  {linha.map(([rotulo, valor]) => (
                    <View key={rotulo} style={s.clienteCel}>
                      <Campo rotulo={rotulo} valor={valor} />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </Secao>
        )}

        {/* ------------------------------------------------- produtos */}
        <Secao titulo={ehRecibo ? "MATERIAIS RETIRADOS" : "PRODUTOS/SERVIÇOS"} inteira={false} semRecuo>
          <View style={s.cabecalhoTabela} wrap={false}>
            <Text style={[s.th, { width: larguraDados, paddingLeft: 16, paddingRight: 4 }]}>
              {ehRecibo ? "Material" : "Dados Produtos/Serviços"}
            </Text>
            {!ehRecibo && <Text style={[s.th, s.cTipo]}>{"Tipo\nProduto"}</Text>}
            <Text style={[s.th, s.cAcabamento]}>{ehRecibo ? "Motivo" : "Acabamento"}</Text>
            <Text style={[s.th, s.cQtd]}>Qtd.</Text>
            {mostrar && <Text style={[s.th, s.cValor]}>Valor</Text>}
            {mostrar && <Text style={[s.th, s.cTotal]}>Valor Total</Text>}
          </View>

          {p.itens.length === 0 && (
            <View style={s.linhaItem}>
              <Text style={{ paddingLeft: 12 }}>Nenhum item.</Text>
            </View>
          )}
          {p.itens.map((item, indice) => {
            const largura = Number(item.largura ?? 0);
            const altura = Number(item.altura ?? 0);
            const dimensionado = largura > 0 && altura > 0;
            const area = Number(item.area_total ?? 0);
            const unidade = unidadeNoDocumento(item.unidade);
            // No recibo a unidade já vai junto da quantidade ("24,2 M²").
            const unidadeNaDescricao = ehRecibo ? null : unidade;
            // Sem resumo embaixo, a última linha não leva traço: colado na borda
            // da seção ele vira uma linha dupla.
            const semTraco = indice === p.itens.length - 1 && !(mostrar || temArea);
            return (
              <View
                style={semTraco ? [s.linhaItem, { borderBottomWidth: 0 }] : s.linhaItem}
                key={indice}
                wrap={false}
              >
                <View style={[s.cDados, { width: larguraDados }]}>
                  <View style={s.cNumero}>
                    <Circulo n={indice + 1} cor={cor} />
                  </View>
                  <View style={{ flex: 1, paddingRight: 4 }}>
                    <Text>
                      {/* O espaço fica sempre no FIM de cada trecho: quebra de
                          linha bem na emenda de dois trechos (negrito → normal,
                          "M²" pequeno → medidas) ganhava um hífen no meio do
                          nada ("RP400 - M²-"). */}
                      {`${indice + 1} - `}
                      <Text style={s.negrito}>{`${item.descricao} `}</Text>
                      {unidadeNaDescricao ? "- " : ""}
                      {unidadeNaDescricao ? (
                        <Text style={s.unidade}>{`${unidadeNaDescricao}  `}</Text>
                      ) : null}
                      {dimensionado
                        ? `${unidadeNaDescricao ? "" : "- "}${metros(largura)} x ${metros(altura)} - área: ${metrosQuadrados(area)}`
                        : ""}
                    </Text>
                    {temTexto(item.especificacao) && (
                      <Text style={s.especificacao}>{item.especificacao.trim()}</Text>
                    )}
                  </View>
                </View>
                {!ehRecibo && <Text style={s.cTipo}>{item.tipo_produto ?? ""}</Text>}
                <Text style={s.cAcabamento}>{item.acabamento ?? ""}</Text>
                <View style={[s.cQtd, { paddingVertical: 1 }]}>
                  <Text>
                    {quantidadeBR(Number(item.quantidade ?? 0))}
                    {ehRecibo && unidade ? ` ${unidade}` : ""}
                  </Text>
                  {dimensionado && (
                    <>
                      <Text style={s.metragem}>Metragem:</Text>
                      <Text style={s.metragem}>
                        {metros(largura)} x {metros(altura)}
                      </Text>
                      <Text style={s.metragem}>= {metrosQuadrados(area)}</Text>
                    </>
                  )}
                </View>
                {mostrar && <Text style={s.cValor}>{dinheiro(item.valor_unitario)}</Text>}
                {mostrar && <Text style={s.cTotal}>{dinheiro(item.valor_total)}</Text>}
              </View>
            );
          })}

          {(mostrar || temArea) && (
            <View style={[s.resumoItens, { backgroundColor: fundoClaro }]} wrap={false}>
              {mostrar && <Text style={s.negrito}>Total Produtos {dinheiro(subtotal)}</Text>}
              {temArea && (
                <Text style={s.negrito}>
                  Soma área total: {metrosQuadrados(Number(p.soma_area))}
                </Text>
              )}
            </View>
          )}
        </Secao>

        {/* --------------------------------------------------- layout */}
        {layouts.length > 0 && (
          // No 3D a imagem é a foto da peça pronta, não uma arte: título próprio.
          // Um cartão por item, com o nome na barra: o cliente sabe o que está
          // olhando sem voltar à tabela.
          <Secao titulo={eh3d ? "FOTO DO MODELO" : "LAYOUT - REFERÊNCIAS"} inteira={false}>
            <View style={s.cartoes}>
              {layouts.map(({ item, numero }, i) => (
                <View style={s.cartao} key={numero} wrap={false}>
                  <View style={[s.cartaoTopo, { backgroundColor: corDoCartao(i) }]}>
                    <View style={s.cartaoCirculo}>
                      <Text style={[s.cartaoCirculoTexto, { color: corDoCartao(i) }]}>{numero}</Text>
                    </View>
                    <Text style={s.cartaoTitulo} {...UMA_LINHA}>
                      {item.descricao.trim()}
                    </Text>
                  </View>
                  <View style={s.cartaoArte}>
                    {item.layout_url && !item.layout_sem_previa ? (
                      <Image style={s.cartaoImagem} src={item.layout_url} />
                    ) : (
                      <View style={s.cartaoSemPrevia}>
                        <Text style={s.cartaoSemPreviaTexto}>
                          {eh3d ? "foto sem prévia" : "arte sem prévia"}: {item.layout_nome ?? "arquivo"}
                        </Text>
                      </View>
                    )}
                  </View>
                  {(item.layouts_extras ?? 0) > 0 && (
                    <Text style={s.cartaoExtras}>+{item.layouts_extras}</Text>
                  )}
                </View>
              ))}
            </View>
          </Secao>
        )}

        {/* ------------------------------------------- entrega e totais */}
        {temEntrega ? (
          <Secao titulo="ENDEREÇO: ENTREGA" direita={abaDoDesconto} semRecuo>
            <View style={s.blocoCorpo}>
              <Text style={s.entregaTexto}>{p.entrega}</Text>
              {totais}
            </View>
          </Secao>
        ) : (
          mostrar && (
            <View style={s.totaisSoltos} wrap={false}>
              <Text>Valor Desconto: {dinheiro(desconto)}</Text>
              <View style={s.totalLinha}>{totais}</View>
            </View>
          )
        )}

        {/* --------------------------------- pagamento e observação */}
        {(mostrarPagamento || observacao != null) && (
          <View style={s.duasColunas} wrap={false}>
            {mostrarPagamento && (
              <Secao
                titulo="PAGAMENTO"
                estilo={observacao != null ? s.colunaPagamento : s.colunaLarga}
              >
                <View style={s.pagamentoLinha}>
                  <Campo rotulo="Forma Pagto" valor={p.pagamento?.forma ?? ""} />
                </View>
                <View style={s.pagamentoLinha}>
                  <Campo rotulo="Condições de Pagamento" valor={nParcelas ? `${nParcelas}x` : ""} />
                </View>
                {parcelas.length > 0 &&
                  (umaSoParcelaSemData ? (
                    <View style={[s.pilula, { backgroundColor: fundoClaro, borderColor: cor }]}>
                      <Text style={s.pilulaTexto}>{dinheiro(parcelas[0].valor)}</Text>
                    </View>
                  ) : (
                    <View style={s.parcelasLista}>
                      {parcelas.map((parcela) => (
                        <Text key={parcela.numero} style={s.parcela}>
                          <Text style={s.negrito}>{parcela.numero}ª </Text>
                          {dinheiro(parcela.valor)}
                          {parcela.vencimento ? `  venc. ${dataBR(parcela.vencimento)}` : ""}
                          {parcela.pago ? "  (paga)" : ""}
                        </Text>
                      ))}
                    </View>
                  ))}
              </Secao>
            )}
            {observacao != null && (
              <Secao titulo="OBSERVAÇÃO" estilo={s.colunaLarga}>
                <Text style={condicoesGerais ? s.textoCondicoes : s.textoCaixa}>{observacao}</Text>
              </Secao>
            )}
          </View>
        )}
        {viaDeProducao && temTexto(p.observacao_interna) && (
          <Secao titulo="OBSERVAÇÃO INTERNA">
            <Text style={s.textoCaixa}>{p.observacao_interna}</Text>
          </Secao>
        )}

        {/* ------------------------------------------- custo (interno) */}
        {mostrar &&
          p.custos &&
          ((p.custos.tarifas?.length ?? 0) > 0 || (p.custos.itens?.length ?? 0) > 0) && (
            <Secao titulo="USO INTERNO — BASE DE CUSTO">
              {(p.custos.tarifas?.length ?? 0) > 0 && (
                <Text style={s.textoCaixa}>
                  {(p.custos.tarifas ?? []).map((t) => `${t.rotulo}: ${t.valor}`).join("   ·   ")}
                </Text>
              )}
              {(p.custos.itens ?? []).map((item, i) => (
                <Text key={i} style={s.textoCaixa}>
                  <Text style={s.negrito}>{i + 1} - </Text>
                  {item.descricao} — previsto {dinheiro(item.custo_previsto_unitario)}/un
                  {item.custo_real_unitario != null
                    ? `, real ${dinheiro(item.custo_real_unitario)}/un`
                    : ", sem custo realizado ainda"}
                  {item.custo_perda ? `, perda ${dinheiro(item.custo_perda)}` : ""}
                  {" · preço "}
                  {dinheiro(item.preco_unitario)}
                  {item.margem_real != null
                    ? ` · margem ${(item.margem_real * 100).toFixed(1).replace(".", ",")}%`
                    : ""}
                </Text>
              ))}
            </Secao>
          )}

        {/* ---------------------------------------------------- fecho */}
        {(ehOrcamento || temTexto(p.vendedor)) && (
          <View style={s.responsavel} wrap={false}>
            <Campo rotulo="Responsável" valor={p.vendedor ?? "—"} />
            {ehOrcamento && (
              <View style={s.prazos}>
                <Campo
                  rotulo="Data de expedição prevista"
                  valor={p.data_expedicao ?? p.data_entrega ?? "a combinar"}
                />
                {/* O prazo do orçamento mora só aqui. Quando a entrega prometida
                    ao cliente não é o dia em que a produção fecha, as duas saem —
                    senão a data combinada com o cliente sumia do papel. */}
                {!!p.data_entrega && !!p.data_expedicao && p.data_entrega !== p.data_expedicao && (
                  <Campo rotulo="Entrega ao cliente" valor={p.data_entrega} />
                )}
              </View>
            )}
          </View>
        )}
        {ehOrcamento && mostrar && p.data_validade && (
          <Text style={s.validade}>Esse orçamento é válido até {p.data_validade}.</Text>
        )}

        {ehOrcamento ? (
          mostrar && (
            <View style={s.aceite} wrap={false}>
              <Text style={s.aceiteTexto}>
                Estou de acordo com o orçamento e autorizo gerar o pedido. Data ____/____/_______.
              </Text>
              <View style={s.assinaturaLinha} />
              <Text style={s.assinaturaRotulo}>Nome e CPF</Text>
            </View>
          )
        ) : (
          <View style={s.assinaturas} wrap={false}>
            <View style={s.assinatura}>
              <Text style={s.assinaturaTexto}>
                {p.assinaturas?.esquerda ??
                  `${p.vendedor ?? "Responsável"} (${empresa.razao_social ?? empresa.nome})`}
              </Text>
            </View>
            <View style={s.assinatura}>
              <Text style={s.assinaturaTexto}>{p.assinaturas?.direita ?? p.cliente.nome}</Text>
            </View>
          </View>
        )}

        {/* --------------------------------------------------- rodapé */}
        <View style={s.rodape} fixed>
          {temRodape && (
            <>
              <Faixa cores={faixa} estilo={{ marginTop: 0 }} />
              <View style={s.rodapeBarra}>
                {contatos.map((c, i) => (
                  <View key={c.rotulo} style={[s.rodapeContato, c.estilo]}>
                    <Text style={[s.rodapeRotulo, { color: corDoCartao(i) }]}>{c.rotulo}</Text>
                    <Text style={s.rodapeTexto}>{c.valor}</Text>
                  </View>
                ))}
                {temTexto(empresa.logo_escura_url) && (
                  <Image style={s.rodapeLogo} src={empresa.logo_escura_url} />
                )}
              </View>
            </>
          )}
          <View style={s.rodapePagina}>
            <Text>
              {identificacao}
              {marcaDaVia ? ` — ${marcaDaVia}` : ""}
            </Text>
            <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
          </View>
        </View>
      </Page>
    </Document>
  );
}
