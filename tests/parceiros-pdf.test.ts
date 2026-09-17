import { describe, expect, it } from "vitest";
import { DocumentoPDF } from "../src/lib/pdf/DocumentoPDF";
import {
  CONDICOES_PADRAO,
  COR_PADRAO_DA_MARCA,
  empresaDoParceiro,
  nomeDoArquivo,
  propsDoOrcamentoDoParceiro,
  type OrcamentoDoParceiro,
} from "../src/domain/parceiros/pdf";
import type { MarcaDoParceiro } from "../src/domain/parceiros/painel";
import type { ItemDoCatalogo, ItemDoOrcamento } from "../src/domain/parceiros/preco";
import { rotuloDoDocumento } from "../src/domain/documentos";

const marca: MarcaDoParceiro = {
  nome: "Gráfica do Zé",
  documento: "52998224725",
  telefone: "96991112233",
  email: "ze@exemplo.com",
  endereco: "Rua das Flores, 10",
  cidade: "Macapá",
  estado: "AP",
  cor: "#1d4ed8",
  logo_path: "p/logo.png",
  rodape: null,
};

const lona: ItemDoCatalogo = {
  produto_id: "lona",
  nome: "Lona 440g",
  categoria: "Lona",
  unidade: "m2",
  por_area: true,
  area_minima: 0.25,
  preco_referencia: 70,
  preco_parceiro: 63,
  origem: "nivel",
  oferta_id: null,
  oferta_titulo: null,
  faixas: null,
  tamanhos: [],
};

const orcamento: OrcamentoDoParceiro = {
  numero: 12,
  titulo: "Fachada",
  cliente_nome: "Padaria do Zé Café",
  cliente_telefone: "96981234567",
  cliente_email: null,
  cliente_documento: "11222333000181",
  observacoes: null,
  validade_dias: 7,
  created_at: "2026-09-16T15:00:00-03:00",
};

const itens: ItemDoOrcamento[] = [
  { produto_id: "lona", descricao: "Lona 440g com ilhós", unidade: "m2", largura: 2, altura: 1, quantidade: 3, preco_venda_unidade: 90, acabamento: "Ilhós" },
  { produto_id: null, descricao: "Instalação", unidade: "un", largura: null, altura: null, quantidade: 1, preco_venda_unidade: 150 },
];

const montar = () =>
  propsDoOrcamentoDoParceiro({
    orcamento,
    itens,
    catalogo: new Map([["lona", lona]]),
    marca,
    nomeDoParceiro: "Zé Revendas",
    logoUrl: null,
  });

describe("emissor é o parceiro", () => {
  it("usa só os dados da marca dele, com CPF e telefone formatados", () => {
    const e = empresaDoParceiro(marca, "Zé Revendas", "https://x/logo.png");
    expect(e).toMatchObject({
      nome: "Gráfica do Zé",
      cnpj: "529.982.247-25",
      telefones: "(96) 99111-2233",
      site: null,
      logo_url: "https://x/logo.png",
      cor: "#1d4ed8",
      condicoes_gerais: CONDICOES_PADRAO,
    });
  });

  it("sem nome de marca usa o nome do parceiro; cor inválida volta ao padrão", () => {
    const e = empresaDoParceiro({ ...marca, nome: "  ", cor: "azul" }, "Zé Revendas", null);
    expect(e.nome).toBe("Zé Revendas");
    expect(e.cor).toBe(COR_PADRAO_DA_MARCA);
  });

  it("o rodapé do parceiro substitui as condições", () => {
    expect(empresaDoParceiro({ ...marca, rodape: "Pix 50% na aprovação." }, "Zé", null).condicoes_gerais).toBe(
      "Pix 50% na aprovação.",
    );
  });

  it("o documento diz CPF quando é CPF", () => {
    expect(rotuloDoDocumento("529.982.247-25")).toBe("CPF");
    expect(rotuloDoDocumento("11.222.333/0001-81")).toBe("CNPJ");
    expect(rotuloDoDocumento(null)).toBe("CNPJ");
  });
});

describe("orçamento com a marca do parceiro", () => {
  it("valores são os de venda do parceiro, nunca o custo dele", () => {
    const p = montar();
    expect(p.itens.map((i) => [i.valor_unitario, i.valor_total])).toEqual([
      [180, 540],
      [150, 150],
    ]);
    expect(p.total).toBe(690);
    expect(p.itens[0]).toMatchObject({ unidade: "m²", area_total: 6, acabamento: "Ilhós" });
    expect(p.soma_area).toBe(6);
  });

  it("validade, cliente e responsável saem do orçamento e da marca", () => {
    const p = montar();
    expect(p.data_validade).toBe("23/09/2026");
    expect(p.vendedor).toBe("Gráfica do Zé");
    expect(p.cliente).toMatchObject({ documento: "11.222.333/0001-81", telefone: "(96) 98123-4567" });
  });

  it("nenhum dado da gráfica entra no documento", () => {
    const texto = JSON.stringify(montar()).toLowerCase();
    for (const proibido of ["bex", "print os", "63", "custo"]) {
      expect(texto, `"${proibido}" apareceu no PDF do parceiro`).not.toContain(proibido);
    }
  });

  it("renderiza um PDF válido", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(DocumentoPDF(montar()) as any);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 30_000);

  it("nome do arquivo sem acento", () => {
    expect(nomeDoArquivo(orcamento)).toBe("Orcamento-12-padaria-do-ze-cafe.pdf");
  });
});
