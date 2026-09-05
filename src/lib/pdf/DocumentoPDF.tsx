import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { enderecoCompleto, type Empresa } from "./empresa";

export type DocItem = {
  codigo?: string | number;
  descricao: string;
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
  /** URL assinada da arte de capa; alimenta o bloco LAYOUT */
  layout_url?: string | null;
  /** demais artes anexadas ao item, listadas abaixo da capa */
  layouts_extras?: string[];
};

export type DocumentoPDFProps = {
  tipo: "orcamento" | "os" | "orcamento_3d";
  numero: number | string;
  data_solicitacao?: string | null;
  data_validade?: string | null;
  data_entrega?: string | null;
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
  pagamento?: {
    forma?: string | null;
    parcelas?: number | null;
    valor_parcela?: number | null;
  } | null;
  entrega?: string | null;
  observacoes?: string | null;
  mostrarValores?: boolean;
  /**
   * Composição de custos da planilha (tabela custos_tabela) + custo previsto
   * dos itens. Só é impressa na via interna/produção — nunca na via do cliente.
   */
  custos?: {
    linhas: { descricao: string; unidade?: string | null; valor: number }[];
    custo_itens?: number | null;
    receita?: number | null;
  } | null;
};


/**
 * Layout espelhado no orçamento que a gráfica já entrega hoje: blocos com
 * moldura, títulos centralizados e sublinhados, metragem dentro da coluna de
 * quantidade e termo de aceite no rodapé. A cor da marca vem do banco, daí a
 * fábrica de estilos.
 */
const criarEstilos = (C: string) =>
  StyleSheet.create({
    page: {
      paddingTop: 24,
      paddingBottom: 40,
      paddingHorizontal: 24,
      fontSize: 8.5,
      fontFamily: "Helvetica",
      color: "#111",
    },

    headerRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 6 },
    logoImg: { width: 150, height: 68, objectFit: "contain", marginRight: 14 },
    logoBox: {
      width: 150,
      height: 68,
      marginRight: 14,
      borderWidth: 1,
      borderColor: C,
      borderRadius: 3,
      alignItems: "center",
      justifyContent: "center",
    },
    logoTxt: { color: C, fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "center" },
    empresaCol: { flex: 1 },
    empresaNome: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginBottom: 1 },
    empresaInfo: { fontSize: 8, color: "#222", lineHeight: 1.35 },
    numeroDoc: { fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "right", minWidth: 120 },

    datasRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: "#111",
      paddingBottom: 2,
      marginBottom: 4,
    },
    dataTxt: { fontSize: 8.5 },
    dataLabel: { fontFamily: "Helvetica-Bold" },

    bloco: { borderWidth: 1, borderColor: "#111", borderRadius: 3, padding: 6, marginBottom: 5 },
    blocoTitulo: {
      fontSize: 9,
      fontFamily: "Helvetica-Bold",
      textAlign: "center",
      textDecoration: "underline",
      marginBottom: 4,
    },

    clienteGrid: { flexDirection: "row" },
    clienteCol: { width: "50%", paddingRight: 8 },
    clienteLinha: { flexDirection: "row", marginBottom: 2 },
    campoLabel: { fontFamily: "Helvetica-Bold", fontSize: 8.5 },
    campoValor: { fontSize: 8.5, flex: 1 },

    thead: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: "#111",
      paddingBottom: 3,
      marginBottom: 2,
      alignItems: "flex-end",
    },
    th: { fontSize: 8, fontFamily: "Helvetica-Bold" },
    tr: {
      flexDirection: "row",
      paddingVertical: 4,
      borderBottomWidth: 0.5,
      borderBottomColor: "#ccc",
      alignItems: "flex-start",
    },
    td: { fontSize: 8.5 },
    tdMuted: { fontSize: 7.5, color: "#444", lineHeight: 1.3 },

    cNum: { width: "4%" },
    cDesc: { width: "38%", paddingRight: 6 },
    cTipo: { width: "8%", textAlign: "center" },
    cAcab: { width: "12%", paddingRight: 4 },
    cQtd: { width: "16%" },
    cVu: { width: "11%", textAlign: "right" },
    cVt: { width: "11%", textAlign: "right" },

    totaisItens: { paddingTop: 4, marginTop: 2 },
    totalItensTxt: { fontSize: 8.5, fontFamily: "Helvetica-Bold" },

    layoutRow: { flexDirection: "row", flexWrap: "wrap" },
    layoutCard: { width: 132, marginRight: 8, marginBottom: 8 },
    layoutImgBox: {
      borderWidth: 0.5,
      borderColor: "#bbb",
      borderRadius: 2,
      height: 82,
      alignItems: "center",
      justifyContent: "center",
      padding: 2,
    },
    layoutImg: { width: "100%", height: "100%", objectFit: "contain" },
    layoutNum: { fontSize: 7.5, marginTop: 2, color: "#333" },

    totaisDir: { alignItems: "flex-end", marginBottom: 5 },
    totalLinha: { fontSize: 8.5, marginBottom: 2 },
    totalForte: { fontSize: 10, fontFamily: "Helvetica-Bold" },

    pagamentoCaixa: {
      borderWidth: 0.5,
      borderColor: "#111",
      borderRadius: 2,
      paddingVertical: 3,
      paddingHorizontal: 5,
      marginTop: 3,
    },

    rodapeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
    rodapeTxt: { fontSize: 8.5 },
    validade: { fontSize: 8.5, marginTop: 2 },

    aceite: { marginTop: 26, alignItems: "center" },
    aceiteTexto: { fontSize: 8.5, marginBottom: 26, textAlign: "center" },
    aceiteLinha: { borderTopWidth: 1, borderTopColor: "#111", width: 300, paddingTop: 3 },
    aceiteLabel: { fontSize: 8, textAlign: "center" },

    signRow: { flexDirection: "row", marginTop: 30, gap: 40 },
    signBox: { flex: 1, borderTopWidth: 1, borderTopColor: "#111", paddingTop: 3, alignItems: "center" },
    signLabel: { fontSize: 8 },

    footer: {
      position: "absolute",
      bottom: 14,
      left: 24,
      right: 24,
      flexDirection: "row",
      justifyContent: "space-between",
      fontSize: 7,
      color: "#888",
      borderTopWidth: 0.5,
      borderTopColor: "#ddd",
      paddingTop: 3,
    },
    producaoBadge: {
      position: "absolute",
      top: 8,
      right: 24,
      fontSize: 8.5,
      color: C,
      fontFamily: "Helvetica-Bold",
      borderWidth: 1,
      borderColor: C,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
  });

const money = (v: number) =>
  "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const m2 = (v: number) => v.toFixed(3).replace(".", ",") + "m²";
const metros = (v: number) => v.toFixed(3).replace(".", ",") + "m";
const qtdFmt = (v: number) =>
  Number.isInteger(v) ? String(v) : v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

function Campo({
  label,
  valor,
  s,
}: {
  label: string;
  valor?: string | null;
  s: ReturnType<typeof criarEstilos>;
}) {
  return (
    <View style={s.clienteLinha}>
      <Text style={s.campoLabel}>{label}: </Text>
      <Text style={s.campoValor}>{valor ?? ""}</Text>
    </View>
  );
}

export function DocumentoPDF(p: DocumentoPDFProps) {
  const empresa = p.empresa;
  const C = empresa.cor;
  const s = criarEstilos(C);

  const isOrc = p.tipo === "orcamento" || p.tipo === "orcamento_3d";
  const titulo = p.tipo === "os" ? "Ordem de Serviço" : p.tipo === "orcamento_3d" ? "Orçamento 3D" : "Orçamento";
  const mostrar = p.mostrarValores ?? true;
  const agora = new Date().toLocaleString("pt-BR");

  // Cada arte anexada vira um quadro no bloco LAYOUT, numerado igual ao item.
  const layouts: { numero: string; url: string; descricao: string }[] = [];
  p.itens.forEach((item, indice) => {
    if (item.layout_url) {
      layouts.push({ numero: String(indice + 1), url: item.layout_url, descricao: item.descricao });
    }
    (item.layouts_extras ?? []).forEach((url, i) => {
      layouts.push({
        numero: `${indice + 1}.${i + 2}`,
        url,
        descricao: item.descricao,
      });
    });
  });

  const totalItens = p.itens.reduce((a, i) => a + Number(i.valor_total || 0), 0);
  const temArea = (p.soma_area ?? 0) > 0;
  const desconto = Number(p.desconto ?? 0);
  const enderecoEmpresa = enderecoCompleto(empresa);
  const cidadeUf = [p.cliente.cidade, p.cliente.estado].filter(Boolean).join(" - ");

  return (
    <Document title={`${titulo} ${p.numero}`} author={empresa.razao_social ?? empresa.nome}>
      <Page size="A4" style={s.page}>
        {!mostrar && (
          <Text style={s.producaoBadge} fixed>
            VIA DE PRODUÇÃO
          </Text>
        )}

        {/* Cabeçalho da empresa — repetido em toda página */}
        <View style={s.headerRow} fixed>
          {empresa.logo_url ? (
            <Image style={s.logoImg} src={empresa.logo_url} />
          ) : (
            <View style={s.logoBox}>
              <Text style={s.logoTxt}>{empresa.nome}</Text>
            </View>
          )}
          <View style={s.empresaCol}>
            <Text style={s.empresaNome}>{(empresa.razao_social ?? empresa.nome).toUpperCase()}</Text>
            {enderecoEmpresa && <Text style={s.empresaInfo}>{enderecoEmpresa.toUpperCase()}</Text>}
            <Text style={s.empresaInfo}>
              {[
                empresa.cnpj ? `CNPJ: ${empresa.cnpj}` : null,
                empresa.inscricao_estadual ? `IE: ${empresa.inscricao_estadual}` : null,
              ]
                .filter(Boolean)
                .join(" - ")}
            </Text>
            {empresa.telefones && <Text style={s.empresaInfo}>Fone: {empresa.telefones}</Text>}
            {empresa.email && <Text style={s.empresaInfo}>{empresa.email}</Text>}
          </View>
          <Text style={s.numeroDoc}>
            {titulo}: Nº {p.numero}
          </Text>
        </View>

        <View style={s.datasRow}>
          <Text style={s.dataTxt}>
            <Text style={s.dataLabel}>Data de Emissão: </Text>
            {p.data_solicitacao ?? "—"}
          </Text>
          <Text style={s.dataTxt}>
            <Text style={s.dataLabel}>Data de Entrega: </Text>
            {p.data_entrega ?? "—"}
          </Text>
        </View>

        {/* DADOS DO CLIENTE */}
        <View style={s.bloco}>
          <View style={s.clienteGrid}>
            <View style={s.clienteCol}>
              <Campo s={s} label="Razão Social" valor={p.cliente.razao_social ?? p.cliente.nome} />
              <Campo s={s} label="CNPJ/CPF" valor={p.cliente.documento} />
              <Campo s={s} label="End" valor={p.cliente.endereco} />
              <Campo s={s} label="CEP" valor={p.cliente.cep} />
              <Campo s={s} label="Telefone" valor={p.cliente.telefone} />
              <Campo s={s} label="E-mail" valor={p.cliente.email} />
            </View>
            <View style={s.clienteCol}>
              <Campo s={s} label="Nome Fantasia" valor={p.cliente.nome_fantasia} />
              <Campo s={s} label="Inscrição Estadual" valor={p.cliente.inscricao_estadual} />
              <Campo s={s} label="Bairro" valor={p.cliente.bairro} />
              <Campo s={s} label="Cidade" valor={cidadeUf} />
              <Campo s={s} label="Celular" valor={p.cliente.celular} />
              <Campo s={s} label="Contato" valor={p.cliente.contato} />
            </View>
          </View>
        </View>

        {/* PRODUTOS/SERVIÇOS */}
        <View style={s.bloco}>
          <Text style={s.blocoTitulo}>PRODUTOS/SERVIÇOS</Text>
          <View style={s.thead}>
            <Text style={[s.th, s.cNum]} />
            <Text style={[s.th, s.cDesc]}>Dados Produtos/Serviços</Text>
            <Text style={[s.th, s.cTipo]}>Tipo Produto</Text>
            <Text style={[s.th, s.cAcab]}>Acabamento</Text>
            <Text style={[s.th, s.cQtd]}>Qtd.</Text>
            {mostrar && <Text style={[s.th, s.cVu]}>Valor</Text>}
            {mostrar && <Text style={[s.th, s.cVt]}>Valor Total</Text>}
          </View>

          {p.itens.length === 0 && (
            <View style={s.tr}>
              <Text style={[s.td, { color: "#999" }]}>Nenhum item</Text>
            </View>
          )}

          {p.itens.map((i, idx) => {
            const dimensionado = Number(i.largura ?? 0) > 0 && Number(i.altura ?? 0) > 0;
            return (
              <View style={s.tr} key={idx} wrap={false}>
                <Text style={[s.td, s.cNum]}>{idx + 1}</Text>
                <View style={s.cDesc}>
                  <Text style={s.td}>
                    <Text style={{ fontFamily: "Helvetica-Bold" }}>
                      {idx + 1} - {i.descricao}
                    </Text>
                    {dimensionado
                      ? ` - ${metros(Number(i.largura))} x ${metros(Number(i.altura))} - área: ${m2(Number(i.area_total ?? 0))}`
                      : ""}
                  </Text>
                </View>
                <Text style={[s.td, s.cTipo]}>{(i.unidade ?? "un").toUpperCase()}</Text>
                <Text style={[s.td, s.cAcab]}>{i.acabamento ?? ""}</Text>
                <View style={s.cQtd}>
                  <Text style={s.td}>{qtdFmt(Number(i.quantidade))}</Text>
                  {dimensionado && (
                    <Text style={s.tdMuted}>
                      Metragem:{"\n"}
                      {metros(Number(i.largura))} x {metros(Number(i.altura))}
                      {"\n"}= {m2(Number(i.area_total ?? 0))}
                    </Text>
                  )}
                </View>
                {mostrar && <Text style={[s.td, s.cVu]}>{money(Number(i.valor_unitario))}</Text>}
                {mostrar && <Text style={[s.td, s.cVt]}>{money(Number(i.valor_total))}</Text>}
              </View>
            );
          })}

          <View style={s.totaisItens}>
            {mostrar && (
              <Text style={s.totalItensTxt}>Total Produtos {money(totalItens)}</Text>
            )}
            {temArea && (
              <Text style={s.totalItensTxt}>Soma área total: {m2(Number(p.soma_area))}</Text>
            )}
          </View>
        </View>

        {/* LAYOUT */}
        {layouts.length > 0 && (
          <View style={s.bloco} wrap={false}>
            <Text style={s.blocoTitulo}>LAYOUT</Text>
            <View style={s.layoutRow}>
              {layouts.map((l, idx) => (
                <View style={s.layoutCard} key={`${l.numero}-${idx}`} wrap={false}>
                  <View style={s.layoutImgBox}>
                    <Image style={s.layoutImg} src={l.url} />
                  </View>
                  <Text style={s.layoutNum}>
                    {l.numero} — {l.descricao}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ENDEREÇO: ENTREGA */}
        <View style={s.bloco} wrap={false}>
          <Text style={s.blocoTitulo}>ENDEREÇO: ENTREGA</Text>
          <Text style={s.td}>{p.entrega ?? "A combinar"}</Text>
        </View>

        {/* Totais */}
        {mostrar && (
          <View style={s.totaisDir}>
            <Text style={s.totalLinha}>Valor Desconto: {money(desconto)}</Text>
            <Text style={s.totalForte}>Valor Total do {titulo}: {money(p.total)}</Text>
          </View>
        )}

        {/* COMPOSIÇÃO DE CUSTOS — via interna */}
        {p.custos && p.custos.linhas.length > 0 && (
          <View style={s.bloco}>
            <Text style={s.blocoTitulo}>COMPOSIÇÃO DE CUSTOS — USO INTERNO</Text>
            {p.custos.linhas.map((c, idx) => (
              <Text style={s.td} key={`custo-${idx}`}>
                <Text style={s.campoLabel}>{c.descricao}: </Text>
                {/* tarifa em porcentagem não leva R$ */}
                {c.unidade && c.unidade.includes("%")
                  ? `${c.valor.toFixed(2).replace(".", ",")}%`
                  : `${money(c.valor)}${c.unidade ? ` / ${c.unidade}` : ""}`}
              </Text>
            ))}
            {p.custos.custo_itens != null && (
              <Text style={s.td}>
                <Text style={s.campoLabel}>Custo previsto dos itens: </Text>
                {money(Number(p.custos.custo_itens))}
                {p.custos.receita
                  ? ` — margem prevista ${(
                      ((Number(p.custos.receita) - Number(p.custos.custo_itens)) /
                        Number(p.custos.receita)) *
                      100
                    ).toFixed(1)}%`
                  : ""}
              </Text>
            )}
          </View>
        )}

        {/* PAGAMENTO */}

        {mostrar && p.pagamento && (
          <View style={s.bloco} wrap={false}>
            <Text style={s.blocoTitulo}>PAGAMENTO</Text>
            <Text style={s.td}>
              <Text style={s.campoLabel}>Forma Pagto: </Text>
              {p.pagamento.forma ?? "A combinar"}
            </Text>
            <Text style={s.td}>
              <Text style={s.campoLabel}>Condições de Pagamento: </Text>
              {p.pagamento.parcelas ? `${p.pagamento.parcelas}x` : "À vista"}
            </Text>
            <View style={s.pagamentoCaixa}>
              <Text style={s.td}>
                {money(Number(p.pagamento.valor_parcela ?? p.total))}
                {p.pagamento.parcelas && p.pagamento.parcelas > 1
                  ? ` x ${p.pagamento.parcelas}`
                  : ""}
              </Text>
            </View>
          </View>
        )}

        {/* OBSERVAÇÃO */}
        <View style={s.bloco} wrap={false}>
          <Text style={s.blocoTitulo}>OBSERVAÇÃO</Text>
          <Text style={s.tdMuted}>
            {p.observacoes ??
              empresa.condicoes_gerais ??
              "Layouts devem ser entregues com antecedência mínima de 3 dias úteis. Favor conferir os dados cadastrais para emissão do documento fiscal."}
          </Text>
        </View>

        <View style={s.rodapeRow}>
          <Text style={s.rodapeTxt}>
            <Text style={s.campoLabel}>Responsável: </Text>
            {p.vendedor ?? "—"}
          </Text>
          <Text style={s.rodapeTxt}>
            <Text style={s.campoLabel}>Data de expedição prevista: </Text>
            {p.data_entrega ?? "a combinar"}
          </Text>
        </View>
        {isOrc && p.data_validade && (
          <Text style={s.validade}>Esse orçamento é válido até {p.data_validade}.</Text>
        )}

        {isOrc && mostrar ? (
          <View style={s.aceite} wrap={false}>
            <Text style={s.aceiteTexto}>
              Estou de acordo com o orçamento e autorizo gerar o pedido. Data ____/____/_______.
            </Text>
            <View style={s.aceiteLinha}>
              <Text style={s.aceiteLabel}>Nome e CPF</Text>
            </View>
          </View>
        ) : (
          <View style={s.signRow} wrap={false}>
            <View style={s.signBox}>
              <Text style={s.signLabel}>
                {p.vendedor ?? "Responsável"} ({empresa.razao_social ?? empresa.nome})
              </Text>
            </View>
            <View style={s.signBox}>
              <Text style={s.signLabel}>{p.cliente.nome}</Text>
            </View>
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>{empresa.site ?? empresa.nome}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
          <Text>{agora}</Text>
        </View>
      </Page>
    </Document>
  );
}
