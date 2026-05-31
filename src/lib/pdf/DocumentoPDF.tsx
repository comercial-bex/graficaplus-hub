import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { EMPRESA } from "./empresa";

export type DocItem = {
  codigo?: string | number;
  descricao: string;
  unidade?: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
};

export type DocumentoPDFProps = {
  tipo: "orcamento" | "os";
  numero: number | string;
  data_solicitacao?: string | null;
  data_validade?: string | null;
  data_entrega?: string | null;
  vendedor?: string | null;
  status?: string | null;
  cliente: {
    nome: string;
    documento?: string | null;
    endereco?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
    telefone?: string | null;
    email?: string | null;
  };
  itens: DocItem[];
  total: number;
  observacoes?: string | null;
  mostrarValores?: boolean;
};

const C = EMPRESA.cor;

const s = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 48, paddingHorizontal: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1a1a1a" },
  topBar: { height: 6, backgroundColor: C, marginBottom: 6 },

  headerRow: { flexDirection: "row", marginBottom: 14 },
  empresaCol: { width: "45%", paddingRight: 12 },
  docCol: { width: "55%", borderLeftWidth: 1, borderLeftColor: "#e5e5e5", paddingLeft: 14 },
  logoBox: { width: 140, height: 52, borderWidth: 1, borderColor: C, borderRadius: 4, alignItems: "center", justifyContent: "center", marginBottom: 8 },
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

  cCode: { width: "8%" },
  cDesc: { width: "50%", paddingRight: 6 },
  cUn: { width: "8%", textAlign: "center" },
  cQtd: { width: "10%", textAlign: "right" },
  cVu: { width: "12%", textAlign: "right" },
  cVt: { width: "12%", textAlign: "right" },

  totalsRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10 },
  totalBox: { borderWidth: 1.5, borderColor: C, padding: 10, minWidth: 200, alignItems: "flex-end" },
  totalLabel: { fontSize: 8, color: C, marginBottom: 2, fontFamily: "Helvetica-Bold" },
  totalValue: { fontSize: 16, fontFamily: "Helvetica-Bold", color: C },

  obs: { marginTop: 16, fontSize: 8, color: "#444", lineHeight: 1.5, padding: 8, borderWidth: 0.5, borderColor: "#ddd", borderRadius: 3 },
  obsTitle: { fontSize: 8, color: C, fontFamily: "Helvetica-Bold", marginBottom: 3 },

  signRow: { flexDirection: "row", marginTop: 40, gap: 40 },
  signBox: { flex: 1, borderTopWidth: 1, borderTopColor: "#999", paddingTop: 4, alignItems: "center" },
  signLabel: { fontSize: 8, color: "#555" },

  footer: { position: "absolute", bottom: 16, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#999", borderTopWidth: 0.5, borderTopColor: "#eee", paddingTop: 4 },

  producaoBadge: { position: "absolute", top: 14, right: 32, fontSize: 9, color: C, fontFamily: "Helvetica-Bold", borderWidth: 1, borderColor: C, paddingHorizontal: 6, paddingVertical: 2 },
});

const money = (v: number) =>
  "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DocumentoPDF(p: DocumentoPDFProps) {
  const titulo = p.tipo === "orcamento" ? "Orçamento" : "Ordem de Serviço";
  const mostrar = p.mostrarValores ?? true;
  const totalQtd = p.itens.reduce((a, i) => a + Number(i.quantidade || 0), 0);
  const now = new Date().toLocaleString("pt-BR");

  return (
    <Document title={`${titulo} ${p.numero}`} author={EMPRESA.razao_social}>
      <Page size="A4" style={s.page}>
        <View style={s.topBar} fixed />
        {!mostrar && <Text style={s.producaoBadge} fixed>VIA DE PRODUÇÃO</Text>}

        <View style={s.headerRow}>
          <View style={s.empresaCol}>
            <View style={s.logoBox}><Text style={s.logoTxt}>{EMPRESA.nome}</Text></View>
            <Text style={s.slogan}>“{EMPRESA.slogan}”</Text>
            <Text style={s.empresaNome}>{EMPRESA.razao_social}</Text>
            <Text style={s.empresaInfo}>CNPJ {EMPRESA.cnpj}</Text>
            <Text style={s.empresaInfo}>{EMPRESA.telefones}</Text>
            <Text style={s.empresaInfo}>{EMPRESA.endereco}</Text>
            <Text style={s.empresaInfo}>{EMPRESA.cidade_uf_cep}</Text>
            <Text style={s.empresaInfo}>{EMPRESA.email}</Text>
          </View>

          <View style={s.docCol}>
            <Text style={s.docTitle}>{titulo.toUpperCase()} Nº {p.numero}</Text>

            <View style={s.metaRow}><Text style={s.metaLabel}>Solicitação</Text><Text style={s.metaValue}>{p.data_solicitacao ?? "—"}</Text></View>
            {p.tipo === "orcamento" && (
              <View style={s.metaRow}><Text style={s.metaLabel}>Validade</Text><Text style={s.metaValue}>{p.data_validade ?? "—"}</Text></View>
            )}
            {p.tipo === "os" && (
              <View style={s.metaRow}><Text style={s.metaLabel}>Entrega</Text><Text style={s.metaValue}>{p.data_entrega ?? "—"}</Text></View>
            )}
            <View style={s.metaRow}><Text style={s.metaLabel}>Vendedor</Text><Text style={s.metaValue}>{p.vendedor ?? "—"}</Text></View>
            {p.status && <View style={s.metaRow}><Text style={s.metaLabel}>Status</Text><Text style={s.metaValue}>{p.status}</Text></View>}

            <View style={s.clienteBox}>
              <Text style={s.clienteLabel}>DADOS DO CLIENTE</Text>
              <Text style={s.clienteNome}>{p.cliente.nome}</Text>
              {p.cliente.documento && <Text style={s.empresaInfo}>CNPJ/CPF: {p.cliente.documento}</Text>}
              {p.cliente.endereco && <Text style={s.empresaInfo}>{p.cliente.endereco}</Text>}
              {(p.cliente.cidade || p.cliente.estado || p.cliente.cep) && (
                <Text style={s.empresaInfo}>
                  {[p.cliente.cidade, p.cliente.estado, p.cliente.cep].filter(Boolean).join(" / ")}
                </Text>
              )}
              {(p.cliente.telefone || p.cliente.email) && (
                <Text style={s.empresaInfo}>
                  {[p.cliente.telefone, p.cliente.email].filter(Boolean).join("  |  ")}
                </Text>
              )}
            </View>
          </View>
        </View>

        <Text style={s.sectionTitle} fixed>PRODUTOS / SERVIÇOS</Text>
        <View style={s.thead} fixed>
          <Text style={[s.th, s.cCode]}>Cód.</Text>
          <Text style={[s.th, s.cDesc]}>Descrição</Text>
          <Text style={[s.th, s.cUn]}>Un.</Text>
          <Text style={[s.th, s.cQtd]}>Qtd</Text>
          {mostrar && <Text style={[s.th, s.cVu]}>Vlr.Unit.</Text>}
          {mostrar && <Text style={[s.th, s.cVt]}>Vlr.Total</Text>}
        </View>

        {p.itens.length === 0 && (
          <View style={s.tr}><Text style={[s.td, { color: "#999" }]}>Nenhum item</Text></View>
        )}
        {p.itens.map((i, idx) => (
          <View style={idx % 2 === 1 ? [s.tr, s.trAlt] : s.tr} key={idx} wrap={false}>
            <Text style={[s.td, s.cCode, { color: "#888" }]}>{i.codigo ?? String(idx + 1).padStart(3, "0")}</Text>
            <Text style={[s.td, s.cDesc]}>{i.descricao}</Text>
            <Text style={[s.td, s.cUn]}>{i.unidade ?? "un"}</Text>
            <Text style={[s.td, s.cQtd]}>{Number(i.quantidade).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</Text>
            {mostrar && <Text style={[s.td, s.cVu]}>{money(Number(i.valor_unitario))}</Text>}
            {mostrar && <Text style={[s.td, s.cVt]}>{money(Number(i.valor_total))}</Text>}
          </View>
        ))}

        <View style={[s.tr, { borderBottomWidth: 0, paddingTop: 6 }]}>
          <Text style={[s.td, s.cCode]} />
          <Text style={[s.td, s.cDesc, { color: "#666" }]}>Itens totais</Text>
          <Text style={[s.td, s.cUn]} />
          <Text style={[s.td, s.cQtd, { color: C, fontFamily: "Helvetica-Bold" }]}>
            {totalQtd.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </Text>
          {mostrar && <Text style={[s.td, s.cVu]} />}
          {mostrar && <Text style={[s.td, s.cVt, { color: C, fontFamily: "Helvetica-Bold" }]}>{money(p.total)}</Text>}
        </View>

        {mostrar && (
          <View style={s.totalsRow}>
            <View style={s.totalBox}>
              <Text style={s.totalLabel}>TOTAL GERAL</Text>
              <Text style={s.totalValue}>{money(p.total)}</Text>
            </View>
          </View>
        )}

        {(p.observacoes || p.tipo === "orcamento") && (
          <View style={s.obs}>
            <Text style={s.obsTitle}>OBSERVAÇÕES</Text>
            {p.observacoes && <Text>{p.observacoes}</Text>}
            {!p.observacoes && p.tipo === "orcamento" && (
              <Text>
                1 — Os layouts a serem produzidos deverão ser entregues até 03 (três) dias úteis antes do início da data de exibição, mediante assinatura do pedido, aprovação da arte e comprovação de pagamento.{"\n"}
                2 — Favor conferir os dados cadastrais para emissão de documento fiscal.
              </Text>
            )}
          </View>
        )}

        <Text style={{ fontSize: 9, marginTop: 24 }}>Autorizo em ____ / ____ / ________</Text>
        <View style={s.signRow}>
          <View style={s.signBox}>
            <Text style={s.signLabel}>{p.vendedor ?? "Responsável"} ({EMPRESA.razao_social})</Text>
          </View>
          <View style={s.signBox}>
            <Text style={s.signLabel}>{p.cliente.nome}</Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>{EMPRESA.site}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
          <Text>{now}</Text>
        </View>
      </Page>
    </Document>
  );
}
