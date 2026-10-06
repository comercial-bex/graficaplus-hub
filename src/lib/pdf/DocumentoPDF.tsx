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
 * orçamento 3D — no formato do modelo que a operação já usava (orçamento 1059):
 * monocromático, caixas de canto arredondado, título de seção centralizado em
 * negrito sublinhado. Um visual só para todos os tipos, para a marca ser uma.
 *
 * A cor da marca (`empresa.cor`) fica só na caixa que substitui o logo quando
 * ele não existe: no modelo, o logo é a única coisa colorida da folha.
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
   * Capa da arte do item (bloco LAYOUT). `renderPDFBlob` troca a URL por um
   * data URL JPEG/PNG antes de desenhar (imagens.ts); quando não dá, marca
   * `layout_sem_previa` e o documento mostra a caixa com o nome do arquivo.
   */
  layout_url?: string | null;
  /** Nome do arquivo da capa, para a caixa "arte sem prévia: nome.ext". */
  layout_nome?: string | null;
  layout_sem_previa?: boolean;
  /** Quantas artes o item tem além da capa ("+N" no bloco LAYOUT). */
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

/* ------------------------------------------------------------------------- */
/* Medidas tiradas do modelo (pt; A4 = 595 × 842)                             */
/* ------------------------------------------------------------------------- */

const PRETO = "#000000";
/** Linha fina e escura: no papel do modelo é preta; 0,75 pt a deixa cinza na tela. */
const BORDA = "#3f3f3f";
const LINHA = 0.75;
const RAIO = 4.5;
const MARGEM = 28.5;
/** Recuo interno das caixas, onde começa o texto e a linha das tabelas. */
const RECUO = 4.5;
/** Altura da miniatura no bloco LAYOUT; a largura segue a proporção da arte. */
const ALTURA_LAYOUT = 60;
const LARGURA_UTIL = 595.28 - 2 * MARGEM - 2 * RECUO;

const s = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 34,
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
  cabecalho: { flexDirection: "row", alignItems: "center", minHeight: 110 },
  logo: { width: 150, height: 110, objectFit: "contain", objectPositionX: 0 },
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
  emissor: { flex: 1, paddingLeft: 25, paddingRight: 8 },
  // Sem largura fixa: a coluna do número encolhe ao texto ("Orçamento: Nº 1059")
  // e o bloco do emissor fica com o resto, como no modelo.
  numeroCol: { maxWidth: 150, alignItems: "flex-end", paddingRight: 9 },
  // No orçamento a coluna leva também o cliente: largura fixa, e o bloco do
  // emissor fica com o resto.
  numeroColOrcamento: { width: 172, maxWidth: 172 },
  clienteNoCabecalho: {
    alignSelf: "stretch",
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: LINHA,
    borderTopColor: BORDA,
  },
  clienteNoCabecalhoLinha: { marginTop: 1.5 },
  numero: { fontFamily: "Helvetica-Bold", textAlign: "right" },
  marcaVia: {
    marginTop: 5,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    borderWidth: LINHA,
    borderColor: PRETO,
    paddingHorizontal: 5,
    paddingTop: 2,
    paddingBottom: 1,
  },
  situacao: { marginTop: 4, fontSize: 8, textAlign: "right" },

  datas: { flexDirection: "row", justifyContent: "space-between", marginTop: 3, marginBottom: 1 },

  // caixas
  caixa: {
    borderWidth: LINHA,
    borderColor: BORDA,
    borderRadius: RAIO,
    paddingHorizontal: RECUO,
    paddingTop: 4,
    paddingBottom: 4.5,
    marginTop: 3,
  },
  tituloCaixa: {
    fontFamily: "Helvetica-Bold",
    textDecoration: "underline",
    textAlign: "center",
    marginBottom: 3,
  },
  // lineHeight sem unidade multiplica o fontSize DO MESMO estilo (ou 18, se não
  // houver): por isso os dois andam juntos aqui.
  textoCaixa: { fontSize: 9, lineHeight: 1.3 },
  /** Condições gerais (texto padrão da empresa): letra menor, é o miúdo do contrato. */
  textoCondicoes: { fontSize: 8, lineHeight: 1.3 },

  // cliente
  caixaCliente: { paddingTop: 4.5, paddingBottom: 4.5 },
  clienteLinha: { flexDirection: "row", paddingVertical: 1.7 },
  clienteGrupo: { marginTop: 1.5 },
  clienteCel: { width: "50%", paddingLeft: 2.2, paddingRight: 6 },

  // tabela de itens
  cabecalhoTabela: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: LINHA,
    borderBottomColor: PRETO,
    paddingBottom: 1.5,
  },
  linhaItem: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: LINHA,
    borderBottomColor: PRETO,
    paddingVertical: 1,
    minHeight: 24,
  },
  th: { fontFamily: "Helvetica-Bold" },
  // Círculo + descrição num bloco só: o círculo fica na altura da 1ª linha
  // mesmo quando a especificação acrescenta outras embaixo.
  cDados: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 2 },
  cNumero: { width: 14, paddingTop: 0.6, alignItems: "flex-start" },
  cTipo: { width: 46, paddingRight: 3 },
  cAcabamento: { width: 70, paddingRight: 4 },
  cQtd: { width: 75, paddingRight: 3 },
  cValor: { width: 62, textAlign: "right", paddingRight: 2 },
  cTotal: { width: 78, textAlign: "right" },
  unidade: { fontSize: 6.5 },
  especificacao: { fontSize: 7.5, marginTop: 1.5, color: "#262626", lineHeight: 1.25 },
  metragem: { fontSize: 7.5, lineHeight: 1.2 },
  resumoItens: { paddingTop: 1 },

  // O número do item num círculo; com dois dígitos ele alarga e vira pílula.
  circulo: {
    minWidth: 10.5,
    height: 10.5,
    borderRadius: 5.25,
    borderWidth: LINHA,
    borderColor: PRETO,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 1.2,
  },
  circuloTexto: { fontSize: 7, lineHeight: 1, textAlign: "center", marginTop: 0.8 },

  // layout
  layouts: { flexDirection: "row", flexWrap: "wrap", paddingTop: 6, paddingBottom: 4 },
  layout: { marginRight: 18, marginBottom: 6, position: "relative" },
  layoutImg: { height: ALTURA_LAYOUT, maxWidth: LARGURA_UTIL, objectFit: "contain" },
  layoutSemPrevia: {
    height: ALTURA_LAYOUT,
    width: 150,
    borderWidth: LINHA,
    borderColor: BORDA,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  layoutSemPreviaTexto: { fontSize: 7, textAlign: "center", color: "#333333" },
  layoutNumero: { position: "absolute", top: 1.5, left: 1.5 },
  layoutExtras: {
    position: "absolute",
    bottom: 1.5,
    right: 1.5,
    backgroundColor: "#ffffff",
    borderWidth: LINHA,
    borderColor: PRETO,
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingTop: 1.2,
    paddingBottom: 0.4,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
  },

  // totais
  totais: { alignItems: "flex-end", marginTop: 4, marginBottom: 2, paddingRight: 1.9 },
  totalLinha: { marginTop: 1.7 },

  // pagamento
  parcelasCaixa: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: LINHA,
    borderColor: PRETO,
    marginTop: 1.5,
    paddingHorizontal: 2.2,
    paddingTop: 2,
    paddingBottom: 1.6,
  },
  parcela: { width: "33.33%", paddingRight: 6, paddingVertical: 0.6 },

  // fecho
  responsavel: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
    paddingHorizontal: 2.2,
  },
  prazos: { alignItems: "flex-end" },
  validade: { marginTop: 4, paddingHorizontal: 2.2 },
  aceite: { marginTop: 20, alignItems: "center" },
  aceiteTexto: { textAlign: "center" },
  assinaturaLinha: { marginTop: 28, width: 270, borderTopWidth: LINHA, borderTopColor: PRETO },
  assinaturaRotulo: { marginTop: 9, textAlign: "center" },
  assinaturas: {
    flexDirection: "row",
    marginTop: 40,
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

  rodape: {
    position: "absolute",
    bottom: 14,
    left: MARGEM,
    right: MARGEM,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#555555",
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

function Caixa({
  titulo,
  children,
  inteira = true,
}: {
  titulo: string;
  children?: ReactNode;
  /** false deixa a caixa quebrar entre páginas (tabelas longas). */
  inteira?: boolean;
}) {
  return (
    <View style={s.caixa} wrap={!inteira}>
      <Text style={s.tituloCaixa} minPresenceAhead={30}>
        {titulo}
      </Text>
      {children}
    </View>
  );
}

function Circulo({ n }: { n: number }) {
  return (
    <View style={n >= 10 ? [s.circulo, { paddingHorizontal: 2 }] : s.circulo}>
      <Text style={n >= 10 ? [s.circuloTexto, { fontSize: 6.5 }] : s.circuloTexto}>{n}</Text>
    </View>
  );
}

const temTexto = (v: string | null | undefined): v is string => !!v && v.trim() !== "";

export function DocumentoPDF(p: DocumentoPDFProps) {
  const empresa = p.empresa;
  const ehOrcamento = p.tipo === "orcamento" || p.tipo === "orcamento_3d";
  const ehRecibo = p.tipo === "recibo_material";
  const mostrar = (p.mostrarValores ?? true) && !ehRecibo;
  const titulo = TITULO[p.tipo];
  const viaDeProducao = !mostrar && !ehRecibo;
  const marcaDaVia = viaDeProducao ? "VIA DE PRODUÇÃO" : p.custos ? "USO INTERNO" : null;
  const identificacao = ehRecibo ? `${titulo} — OS Nº ${p.numero}` : `${titulo} Nº ${p.numero}`;

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

  // ------------------------------------------------------------------ itens
  // A coluna de dados (círculo + descrição) fica com o que sobra das outras.
  const larguraDados = LARGURA_UTIL - (ehRecibo ? 0 : 46) - 70 - 75 - (mostrar ? 62 + 78 : 0);
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

  const cidadeDoCliente = [p.cliente.cidade, p.cliente.estado].filter(temTexto).join(" - ");
  const rotuloDocCliente = rotuloDoDocumento(p.cliente.documento);

  return (
    <Document title={identificacao} author={empresa.razao_social ?? empresa.nome}>
      <Page size="A4" style={s.page}>
        {/* ------------------------------------------------ cabeçalho */}
        <View style={s.cabecalho}>
          {empresa.logo_url ? (
            <Image style={s.logo} src={empresa.logo_url} />
          ) : (
            <View style={[s.logoCaixa, { borderColor: empresa.cor }]}>
              <Text style={[s.logoNome, { color: empresa.cor }]}>{empresa.nome}</Text>
              {temTexto(empresa.slogan) && <Text style={s.logoSlogan}>{empresa.slogan}</Text>}
            </View>
          )}
          <View style={s.emissor}>
            <Text style={s.negrito}>{empresa.razao_social ?? empresa.nome}</Text>
            {linhasDoEmissor.map((linha, i) => (
              <Text key={i}>{linha}</Text>
            ))}
          </View>
          <View style={ehOrcamento ? [s.numeroCol, s.numeroColOrcamento] : s.numeroCol}>
            {ehRecibo ? (
              <>
                <Text style={s.numero}>{titulo}</Text>
                <Text style={s.numero}>OS Nº {p.numero}</Text>
              </>
            ) : (
              <Text style={s.numero}>
                {titulo}: Nº {p.numero}
              </Text>
            )}
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

        <View style={s.datas}>
          <Campo rotulo="Data de Emissão" valor={p.data_solicitacao ?? "—"} />
          {!ehOrcamento && (p.tipo === "os" || !!p.data_entrega) && (
            <Campo rotulo="Data de Entrega" valor={p.data_entrega ?? "—"} />
          )}
        </View>

        {/* -------------------------------------------------- cliente */}
        {!ehOrcamento && (
          <View style={[s.caixa, s.caixaCliente]} wrap={false}>
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
        )}

        {/* ------------------------------------------------- produtos */}
        <Caixa titulo={ehRecibo ? "MATERIAIS RETIRADOS" : "PRODUTOS/SERVIÇOS"} inteira={false}>
          <View style={s.cabecalhoTabela} wrap={false}>
            <Text style={[s.th, { width: larguraDados, paddingLeft: 14, paddingRight: 4 }]}>
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
            // da caixa ele vira uma linha dupla.
            const semTraco = indice === p.itens.length - 1 && !(mostrar || temArea);
            return (
              <View
                style={semTraco ? [s.linhaItem, { borderBottomWidth: 0 }] : s.linhaItem}
                key={indice}
                wrap={false}
              >
                <View style={[s.cDados, { width: larguraDados }]}>
                  <View style={s.cNumero}>
                    <Circulo n={indice + 1} />
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
            <View style={s.resumoItens} wrap={false}>
              {mostrar && <Text style={s.negrito}>Total Produtos {dinheiro(subtotal)}</Text>}
              {temArea && (
                <Text style={s.negrito}>
                  Soma área total: {metrosQuadrados(Number(p.soma_area))}
                </Text>
              )}
            </View>
          )}
        </Caixa>

        {/* --------------------------------------------------- layout */}
        {layouts.length > 0 && (
          <Caixa titulo="LAYOUT" inteira={false}>
            <View style={s.layouts}>
              {layouts.map(({ item, numero }) => (
                <View style={s.layout} key={numero} wrap={false}>
                  {item.layout_url && !item.layout_sem_previa ? (
                    <Image style={s.layoutImg} src={item.layout_url} />
                  ) : (
                    <View style={s.layoutSemPrevia}>
                      <Text style={s.layoutSemPreviaTexto}>
                        arte sem prévia: {item.layout_nome ?? "arquivo"}
                      </Text>
                    </View>
                  )}
                  <View style={s.layoutNumero}>
                    <Circulo n={numero} />
                  </View>
                  {(item.layouts_extras ?? 0) > 0 && (
                    <Text style={s.layoutExtras}>+{item.layouts_extras}</Text>
                  )}
                </View>
              ))}
            </View>
          </Caixa>
        )}

        {/* -------------------------------------------------- entrega */}
        {temTexto(p.entrega) && (
          <Caixa titulo="ENDEREÇO: ENTREGA">
            <Text style={s.textoCaixa}>{p.entrega}</Text>
          </Caixa>
        )}

        {/* --------------------------------------------------- totais */}
        {mostrar && (
          <View style={s.totais} wrap={false}>
            <Text>Valor Desconto: {dinheiro(desconto)}</Text>
            <Text style={[s.negrito, s.totalLinha]}>
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
        )}

        {/* ------------------------------------------------ pagamento */}
        {mostrarPagamento && (
          <Caixa titulo="PAGAMENTO">
            <Campo rotulo="Forma Pagto" valor={p.pagamento?.forma ?? ""} />
            <Campo rotulo="Condições de Pagamento" valor={nParcelas ? `${nParcelas}x` : ""} />
            {parcelas.length > 0 && (
              <View style={s.parcelasCaixa}>
                {umaSoParcelaSemData ? (
                  <Text>{dinheiro(parcelas[0].valor)}</Text>
                ) : (
                  parcelas.map((parcela) => (
                    <Text key={parcela.numero} style={s.parcela}>
                      <Text style={s.negrito}>{parcela.numero}ª </Text>
                      {dinheiro(parcela.valor)}
                      {parcela.vencimento ? `  venc. ${dataBR(parcela.vencimento)}` : ""}
                      {parcela.pago ? "  (paga)" : ""}
                    </Text>
                  ))
                )}
              </View>
            )}
          </Caixa>
        )}

        {/* ---------------------------------------------- observações */}
        {observacao != null && (
          <Caixa titulo="OBSERVAÇÃO">
            <Text style={condicoesGerais ? s.textoCondicoes : s.textoCaixa}>{observacao}</Text>
          </Caixa>
        )}
        {viaDeProducao && temTexto(p.observacao_interna) && (
          <Caixa titulo="OBSERVAÇÃO INTERNA">
            <Text style={s.textoCaixa}>{p.observacao_interna}</Text>
          </Caixa>
        )}

        {/* ------------------------------------------- custo (interno) */}
        {mostrar &&
          p.custos &&
          ((p.custos.tarifas?.length ?? 0) > 0 || (p.custos.itens?.length ?? 0) > 0) && (
            <Caixa titulo="USO INTERNO — BASE DE CUSTO">
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
            </Caixa>
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

        <View style={s.rodape} fixed>
          <Text>
            {identificacao}
            {marcaDaVia ? ` — ${marcaDaVia}` : ""}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
