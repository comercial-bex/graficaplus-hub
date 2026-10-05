import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { enderecoCompleto, type Empresa } from "./empresa";
import { rotuloDoDocumento } from "@/domain/documentos";

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
  tipo_produto?: string | null;
  /** URL assinada da arte a imprimir (capa); alimenta o bloco LAYOUT */
  layout_url?: string | null;
  layouts_extras?: string[];
};

export type DocumentoPDFProps = {
  tipo: "orcamento" | "os" | "orcamento_3d" | "recibo_material" | "fatura";
  numero: number | string;
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
  pagamento?: {
    forma?: string | null;
    parcelas?: number | null;
    valor_parcela?: number | null;
  } | null;
  entrega?: string | null;
  observacoes?: string | null;
  /**
   * Parcelas com vencimento e situação. A cobrança sem as datas obriga o cliente
   * a ligar para perguntar quando vence — que é o telefonema que a fatura existe
   * para evitar.
   */
  parcelas?: { numero: number; valor: number; vencimento: string | null; pago: boolean }[] | null;
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
   * Quebra de custo para a via INTERNA — nunca sai no documento do cliente.
   *
   * Existe porque quem forma preço precisa ver, na mesma folha que o cliente
   * assina, com que números o preço foi montado: a tarifa de energia daquele
   * dia, a hora de mão de obra, o custo do material que estava no estoque. Sem
   * isso, conferir um orçamento antigo vira arqueologia.
   */
  custos?: {
    /** Planilha de custos (custos_tabela) — via interna do orçamento e da OS. */
    linhas?: { descricao: string; unidade?: string | null; valor: number }[];
    custo_itens?: number;
    receita?: number;
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

// Os estilos dependem da cor da marca, que agora vem do banco — daí a fábrica.
const criarEstilos = (C: string) =>
  StyleSheet.create({
    page: { paddingTop: 32, paddingBottom: 48, paddingHorizontal: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1a1a1a" },
    topBar: { height: 6, backgroundColor: C, marginBottom: 6 },

    headerRow: { flexDirection: "row", marginBottom: 14 },
    empresaCol: { width: "45%", paddingRight: 12 },
    docCol: { width: "55%", borderLeftWidth: 1, borderLeftColor: "#e5e5e5", paddingLeft: 14 },
    logoBox: { width: 140, height: 52, borderWidth: 1, borderColor: C, borderRadius: 4, alignItems: "center", justifyContent: "center", marginBottom: 8 },
    logoImg: { width: 140, height: 52, objectFit: "contain", marginBottom: 8 },
    logoTxt: { color: C, fontSize: 14, fontFamily: "Helvetica-Bold" },
    slogan: { fontSize: 8, fontStyle: "italic", marginBottom: 4, color: "#555" },
    empresaNome: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 4 },
    empresaInfo: { fontSize: 8, color: "#444", lineHeight: 1.4 },

    docTitle: { fontSize: 16, color: C, marginBottom: 8, fontFamily: "Helvetica-Bold" },
    metaRow: { flexDirection: "row", marginBottom: 3 },
    metaLabel: { width: 72, color: "#777", fontSize: 8 },
    metaValue: { fontSize: 9, fontFamily: "Helvetica-Bold", flex: 1 },

    clienteBox: { marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#e5e5e5" },
    clienteLabel: { fontSize: 8, color: "#777", marginBottom: 2 },
    clienteNome: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 2 },

    sectionTitle: { color: "#fff", backgroundColor: C, fontFamily: "Helvetica-Bold", fontSize: 10, padding: 5, marginTop: 10 },

    thead: { flexDirection: "row", backgroundColor: C, paddingVertical: 5, paddingHorizontal: 4 },
    th: { fontSize: 8, color: "#fff", fontFamily: "Helvetica-Bold" },
    tr: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: "#eee", alignItems: "flex-start" },
    trAlt: { backgroundColor: "#fafafa" },
    td: { fontSize: 9 },
    metragem: { fontSize: 7, color: "#666", marginTop: 1 },

    cCode: { width: "4%" },
    cDesc: { width: "34%", paddingRight: 6 },
    cTipo: { width: "11%", fontSize: 8 },
    cAcab: { width: "11%", fontSize: 8 },
    cQtd: { width: "16%", textAlign: "center", alignItems: "center" },
    cVu: { width: "12%", textAlign: "right" },
    cVt: { width: "12%", textAlign: "right" },

    datasRow: { flexDirection: "row", justifyContent: "space-between", fontSize: 9, marginBottom: 4 },
    clienteGrid: { flexDirection: "row", flexWrap: "wrap", borderWidth: 0.5, borderColor: "#ccc", borderRadius: 3, paddingVertical: 4, paddingHorizontal: 6 },
    clienteCel: { width: "50%", fontSize: 8.5, paddingVertical: 1.5 },
    respLabel: { fontFamily: "Helvetica-Bold", color: "#333" },
    respRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12, fontSize: 9 },
    resumoItens: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: C, fontSize: 9 },

    layoutRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
    layoutCard: { width: 168, borderWidth: 0.5, borderColor: "#ddd", borderRadius: 3, padding: 4 },
    layoutImg: { width: "100%", height: 110, objectFit: "contain" },
    layoutBadge: { fontSize: 9, fontFamily: "Helvetica-Bold", color: C, marginBottom: 2 },
    layoutNum: { fontSize: 7, color: "#666", marginTop: 2, textAlign: "center" },

    infoGrid: { flexDirection: "row", gap: 8, marginTop: 10 },
    infoBox: { flex: 1, borderWidth: 0.5, borderColor: "#ddd", borderRadius: 3, padding: 8 },
    infoTitle: { fontSize: 8, color: C, fontFamily: "Helvetica-Bold", marginBottom: 3 },
    infoLinha: { fontSize: 8, color: "#444", lineHeight: 1.5 },

    totaisBox: { marginTop: 10, alignItems: "flex-end" },
    totalLinha: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 2 },
    totalLinhaLabel: { fontSize: 8, color: "#666", width: 110, textAlign: "right", paddingRight: 8 },
    totalLinhaValor: { fontSize: 9, width: 90, textAlign: "right" },
    totalBox: { borderWidth: 1.5, borderColor: C, padding: 10, minWidth: 200, alignItems: "flex-end", marginTop: 4 },
    totalLabel: { fontSize: 8, color: C, marginBottom: 2, fontFamily: "Helvetica-Bold" },
    totalValue: { fontSize: 16, fontFamily: "Helvetica-Bold", color: C },

    obs: { marginTop: 12, fontSize: 8, color: "#444", lineHeight: 1.5, padding: 8, borderWidth: 0.5, borderColor: "#ddd", borderRadius: 3 },
    obsTitle: { fontSize: 8, color: C, fontFamily: "Helvetica-Bold", marginBottom: 3 },

    aceiteBox: { marginTop: 18, borderWidth: 0.5, borderColor: C, borderRadius: 3, padding: 10 },
    aceiteTexto: { fontSize: 9, marginBottom: 18 },
    aceiteLinha: { borderTopWidth: 1, borderTopColor: "#999", paddingTop: 4, alignItems: "center", marginHorizontal: 40 },
    aceiteLabel: { fontSize: 8, color: "#555" },

    signRow: { flexDirection: "row", marginTop: 24, gap: 40 },
    signBox: { flex: 1, borderTopWidth: 1, borderTopColor: "#999", paddingTop: 4, alignItems: "center" },
    signLabel: { fontSize: 8, color: "#555" },

    footer: { position: "absolute", bottom: 16, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#999", borderTopWidth: 0.5, borderTopColor: "#eee", paddingTop: 4 },
    producaoBadge: { position: "absolute", top: 14, right: 32, fontSize: 9, color: C, fontFamily: "Helvetica-Bold", borderWidth: 1, borderColor: C, paddingHorizontal: 6, paddingVertical: 2 },
  });

const money = (v: number) =>
  "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const m2 = (v: number) => v.toFixed(3).replace(".", ",") + "m²";
const metros = (v: number) => v.toFixed(3).replace(".", ",") + "m";

export function DocumentoPDF(p: DocumentoPDFProps) {
  const empresa = p.empresa;
  const C = empresa.cor;
  const s = criarEstilos(C);

  const isOrc = p.tipo === "orcamento" || p.tipo === "orcamento_3d";
  const titulo =
    p.tipo === "os"
      ? "Ordem de Serviço"
      : p.tipo === "orcamento_3d"
        ? "Orçamento 3D"
        : p.tipo === "recibo_material"
          ? "Recibo de Retirada de Material"
          : p.tipo === "fatura"
            ? "Fatura"
            : "Orçamento";
  const mostrar = p.mostrarValores ?? true;
  const totalQtd = p.itens.reduce((a, i) => a + Number(i.quantidade || 0), 0);
  const agora = new Date().toLocaleString("pt-BR");

  // Itens com arte anexada alimentam o bloco LAYOUT, numerados como na tabela.
  const layouts = p.itens
    .map((item, indice) => ({ item, numero: indice + 1 }))
    .filter((l) => !!l.item.layout_url);

  const temArea = (p.soma_area ?? 0) > 0;
  const desconto = Number(p.desconto ?? 0);
  const enderecoEmpresa = enderecoCompleto(empresa);

  return (
    <Document title={`${titulo} ${p.numero}`} author={empresa.razao_social ?? empresa.nome}>
      <Page size="A4" style={s.page}>
        <View style={s.topBar} fixed />
        {!mostrar && <Text style={s.producaoBadge} fixed>VIA DE PRODUÇÃO</Text>}

        <View style={s.headerRow}>
          <View style={s.empresaCol}>
            {empresa.logo_url ? (
              <Image style={s.logoImg} src={empresa.logo_url} />
            ) : (
              <View style={s.logoBox}>
                <Text style={s.logoTxt}>{empresa.nome}</Text>
              </View>
            )}
            {empresa.slogan && <Text style={s.slogan}>“{empresa.slogan}”</Text>}
            <Text style={s.empresaNome}>{empresa.razao_social ?? empresa.nome}</Text>
            {empresa.cnpj && (
              <Text style={s.empresaInfo}>
                {rotuloDoDocumento(empresa.cnpj)} {empresa.cnpj}
              </Text>
            )}
            {empresa.inscricao_estadual && (
              <Text style={s.empresaInfo}>IE {empresa.inscricao_estadual}</Text>
            )}
            {empresa.telefones && <Text style={s.empresaInfo}>{empresa.telefones}</Text>}
            {enderecoEmpresa && <Text style={s.empresaInfo}>{enderecoEmpresa}</Text>}
            {empresa.email && <Text style={s.empresaInfo}>{empresa.email}</Text>}
          </View>

          <View style={s.docCol}>
            <Text style={s.docTitle}>
              {titulo.toUpperCase()} Nº {p.numero}
            </Text>
            {isOrc && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Validade</Text>
                <Text style={s.metaValue}>{p.data_validade ?? "—"}</Text>
              </View>
            )}
            {!isOrc && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Responsável</Text>
                <Text style={s.metaValue}>{p.vendedor ?? "—"}</Text>
              </View>
            )}
            {p.status && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Status</Text>
                <Text style={s.metaValue}>{p.status}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={s.datasRow}>
          <Text>
            <Text style={s.respLabel}>Data de Emissão: </Text>
            {p.data_solicitacao ?? "—"}
          </Text>
          {(p.data_entrega || p.tipo === "os" || isOrc) && (
            <Text>
              <Text style={s.respLabel}>Data de Entrega: </Text>
              {p.data_entrega ?? "—"}
            </Text>
          )}
        </View>

        <View style={s.clienteGrid} wrap={false}>
          {(
            [
              ["Razão Social", p.cliente.razao_social ?? p.cliente.nome],
              ["Nome Fantasia", p.cliente.nome_fantasia],
              [
                p.cliente.documento ? rotuloDoDocumento(p.cliente.documento).replace(/:$/, "") : "CNPJ",
                p.cliente.documento,
              ],
              ["Inscrição Estadual", p.cliente.inscricao_estadual],
              ["End", p.cliente.endereco],
              ["Bairro", p.cliente.bairro],
              ["CEP", p.cliente.cep],
              ["Cidade", [p.cliente.cidade, p.cliente.estado].filter(Boolean).join(" - ")],
              ["Telefone", p.cliente.telefone],
              ["Celular", p.cliente.celular],
              ["E-mail", p.cliente.email],
              ["Contato", p.cliente.contato],
            ] as [string, string | null | undefined][]
          ).map(([rotulo, valor]) => (
            <Text style={s.clienteCel} key={rotulo}>
              <Text style={s.respLabel}>{rotulo}: </Text>
              {valor || ""}
            </Text>
          ))}
        </View>

        <Text style={s.sectionTitle}>PRODUTOS / SERVIÇOS</Text>
        <View style={s.thead}>
          <Text style={[s.th, s.cCode]}>#</Text>
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
            <View style={idx % 2 === 1 ? [s.tr, s.trAlt] : s.tr} key={idx} wrap={false}>
              <Text style={[s.td, s.cCode, { color: C, fontFamily: "Helvetica-Bold" }]}>
                {idx + 1}
              </Text>
              <View style={s.cDesc}>
                <Text style={s.td}>
                  {i.descricao}
                  {i.unidade ? ` - ${i.unidade.toUpperCase()}` : ""}
                </Text>
                {dimensionado && (
                  <Text style={s.metragem}>
                    {metros(Number(i.largura))} x {metros(Number(i.altura))} - área:{" "}
                    {m2(Number(i.area_total ?? 0))}
                  </Text>
                )}
              </View>
              <Text style={[s.td, s.cTipo]}>{i.tipo_produto ?? "—"}</Text>
              <Text style={[s.td, s.cAcab]}>{i.acabamento ?? "—"}</Text>
              <View style={s.cQtd}>
                <Text style={[s.td, { fontFamily: "Helvetica-Bold" }]}>
                  {Number(i.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                </Text>
                {dimensionado && (
                  <>
                    <Text style={s.metragem}>Metragem:</Text>
                    <Text style={s.metragem}>
                      {metros(Number(i.largura))} x {metros(Number(i.altura))}
                    </Text>
                    <Text style={s.metragem}>= {m2(Number(i.area_total ?? 0))}</Text>
                  </>
                )}
              </View>
              {mostrar && <Text style={[s.td, s.cVu]}>{money(Number(i.valor_unitario))}</Text>}
              {mostrar && <Text style={[s.td, s.cVt]}>{money(Number(i.valor_total))}</Text>}
            </View>
          );
        })}

        <View style={s.resumoItens} wrap={false}>
          {mostrar && (
            <Text>
              <Text style={s.respLabel}>Total Produtos </Text>
              {money(Number(p.subtotal ?? p.total))}
            </Text>
          )}
          <Text>
            <Text style={s.respLabel}>Itens: </Text>
            {totalQtd.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
          </Text>
          {temArea && (
            <Text>
              <Text style={s.respLabel}>Soma área total: </Text>
              {m2(Number(p.soma_area))}
            </Text>
          )}
        </View>

        {layouts.length > 0 && (
          <>
            <Text style={s.sectionTitle}>LAYOUT</Text>
            <View style={s.layoutRow}>
              {layouts.map((l) => (
                <View style={s.layoutCard} key={l.numero} wrap={false}>
                  <Text style={s.layoutBadge}>{l.numero}</Text>
                  <Image style={s.layoutImg} src={l.item.layout_url as string} />
                  <Text style={s.layoutNum}>{l.item.descricao}</Text>
                  {(l.item.layouts_extras?.length ?? 0) > 0 && (
                    <Text style={s.layoutNum}>+{l.item.layouts_extras!.length} arte(s)</Text>
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        <View style={s.infoGrid}>
          {p.entrega && (
            <View style={s.infoBox}>
              <Text style={s.infoTitle}>ENTREGA</Text>
              <Text style={s.infoLinha}>{p.entrega}</Text>
            </View>
          )}
          {mostrar && p.pagamento && (p.pagamento.forma || p.pagamento.parcelas) && (
            <View style={s.infoBox}>
              <Text style={s.infoTitle}>PAGAMENTO</Text>
              {p.pagamento.forma && (
                <Text style={s.infoLinha}>Forma: {p.pagamento.forma}</Text>
              )}
              {p.pagamento.parcelas ? (
                <Text style={s.infoLinha}>
                  Condições: {p.pagamento.parcelas}x
                  {p.pagamento.valor_parcela
                    ? ` de ${money(Number(p.pagamento.valor_parcela))}`
                    : ""}
                </Text>
              ) : null}
            </View>
          )}
        </View>

        {mostrar && (
          <View style={s.totaisBox}>
            {p.subtotal != null && (
              <View style={s.totalLinha}>
                <Text style={s.totalLinhaLabel}>Total produtos</Text>
                <Text style={s.totalLinhaValor}>{money(Number(p.subtotal))}</Text>
              </View>
            )}
            <View style={s.totalLinha}>
              <Text style={s.totalLinhaLabel}>Desconto</Text>
              <Text style={s.totalLinhaValor}>{money(desconto)}</Text>
            </View>
            <View style={s.totalBox}>
              <Text style={s.totalLabel}>TOTAL GERAL</Text>
              <Text style={s.totalValue}>{money(p.total)}</Text>
            </View>
            {/* Na fatura o que interessa é o saldo, não o total: o cliente que já
                pagou a entrada precisa ver quanto ainda deve. */}
            {p.valor_pago != null && p.valor_pago > 0 && (
              <>
                <View style={s.totalLinha}>
                  <Text style={s.totalLinhaLabel}>Já recebido</Text>
                  <Text style={s.totalLinhaValor}>{money(p.valor_pago)}</Text>
                </View>
                <View style={s.totalBox}>
                  <Text style={s.totalLabel}>SALDO EM ABERTO</Text>
                  <Text style={s.totalValue}>{money(p.total - p.valor_pago)}</Text>
                </View>
              </>
            )}
          </View>
        )}

        {p.parcelas && p.parcelas.length > 0 && (
          <View style={s.obs}>
            <Text style={s.obsTitle}>PARCELAS</Text>
            {p.parcelas.map((parcela) => (
              <Text key={parcela.numero}>
                {parcela.numero}ª — {money(parcela.valor)}
                {parcela.vencimento
                  ? ` · vence em ${new Date(`${parcela.vencimento}T00:00:00`).toLocaleDateString("pt-BR")}`
                  : ""}
                {parcela.pago ? " · PAGA" : ""}
              </Text>
            ))}
          </View>
        )}

        {p.custos && (
          <View style={s.obs} wrap={false}>
            <Text style={s.obsTitle}>USO INTERNO — BASE DE CUSTO</Text>
            <Text>
              {(p.custos.tarifas ?? []).map((t) => `${t.rotulo}: ${t.valor}`).join("   ·   ")}
            </Text>
            {(p.custos.itens ?? []).map((item, i) => (
              <Text key={i}>
                {item.descricao} — previsto {money(item.custo_previsto_unitario)}/un
                {item.custo_real_unitario != null
                  ? `, real ${money(item.custo_real_unitario)}/un`
                  : ", sem custo realizado ainda"}
                {item.custo_perda ? `, perda ${money(item.custo_perda)}` : ""}
                {" · preço "}
                {money(item.preco_unitario)}
                {item.margem_real != null ? ` · margem ${(item.margem_real * 100).toFixed(1)}%` : ""}
              </Text>
            ))}
          </View>
        )}

        {(p.observacoes || isOrc) && (
          <View style={s.obs}>
            <Text style={s.obsTitle}>OBSERVAÇÕES</Text>
            {p.observacoes && <Text>{p.observacoes}</Text>}
            {!p.observacoes && isOrc && (
              <Text>
                {empresa.condicoes_gerais ??
                  `1 — Os layouts a serem produzidos deverão ser entregues até 03 (três) dias úteis antes do início da data de exibição, mediante assinatura do pedido, aprovação da arte e comprovação de pagamento.
2 — Favor conferir os dados cadastrais para emissão de documento fiscal.`}
              </Text>
            )}
          </View>
        )}

        {isOrc && (
          <View style={s.respRow} wrap={false}>
            <View style={{ flex: 1 }}>
              <Text>
                <Text style={s.respLabel}>Responsável: </Text>
                {p.vendedor ?? "—"}
              </Text>
              {p.data_validade && (
                <Text style={{ marginTop: 3 }}>Esse orçamento é válido até {p.data_validade}.</Text>
              )}
            </View>
            <Text>
              <Text style={s.respLabel}>Data de expedição prevista: </Text>
              {p.data_expedicao ?? p.data_entrega ?? "—"}
            </Text>
          </View>
        )}

        {isOrc && mostrar ? (
          <View style={s.aceiteBox} wrap={false}>
            <Text style={s.aceiteTexto}>
              Estou de acordo com o orçamento e autorizo gerar o pedido.
              {"     "}Data ____ / ____ / ________
            </Text>
            <View style={s.aceiteLinha}>
              <Text style={s.aceiteLabel}>Nome e CPF</Text>
            </View>
          </View>
        ) : (
          <View style={s.signRow}>
            <View style={s.signBox}>
              <Text style={s.signLabel}>
                {p.assinaturas?.esquerda ??
                  `${p.vendedor ?? "Responsável"} (${empresa.razao_social ?? empresa.nome})`}
              </Text>
            </View>
            <View style={s.signBox}>
              <Text style={s.signLabel}>{p.assinaturas?.direita ?? p.cliente.nome}</Text>
            </View>
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>{empresa.site ?? ""}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
          <Text>{agora}</Text>
        </View>
      </Page>
    </Document>
  );
}
