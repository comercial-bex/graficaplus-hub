/**
 * O orçamento do parceiro no mesmo documento que a gráfica usa — com a marca DELE.
 *
 * O cliente final do parceiro não pode ver a gráfica em lugar nenhum da folha:
 * nem no cabeçalho, nem no rodapé, nem no texto de condições que o documento
 * põe quando o orçamento não tem observação. Por isso o emissor é montado só
 * com os dados que o parceiro cadastrou, e as condições têm um texto próprio,
 * neutro, em vez do padrão da gráfica.
 *
 * Os valores são os de VENDA do parceiro (o que ele cobra), nunca o custo dele.
 */

import type { DocItem, DocumentoPDFProps } from "@/lib/pdf/DocumentoPDF";
import type { Empresa } from "@/lib/pdf/empresa";
import { formatarDocumento, formatarTelefone } from "@/domain/documentos";
import { temDimensoes } from "@/domain/orcamentos/area";
import type { MarcaDoParceiro } from "./painel";
import { validadeDoOrcamento } from "./painel";
import {
  unidadeLegivel,
  vendaDoItem,
  vendidoPorArea,
  type ItemDoCatalogo,
  type ItemDoOrcamento,
} from "./preco";

export const COR_PADRAO_DA_MARCA = "#0f766e";

export const CONDICOES_PADRAO =
  "Valores válidos até a data indicada acima. A produção começa após a aprovação deste orçamento e da arte final.";

export type OrcamentoDoParceiro = {
  numero: number;
  titulo: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  cliente_email: string | null;
  cliente_documento: string | null;
  observacoes: string | null;
  validade_dias: number;
  created_at: string;
};

const semEspaco = (v: string | null | undefined) => (v ?? "").trim() || null;

export function empresaDoParceiro(
  marca: MarcaDoParceiro,
  nomeReserva: string,
  logoUrl: string | null,
): Empresa {
  const documento = semEspaco(marca.documento);
  const telefone = semEspaco(marca.telefone);
  return {
    nome: semEspaco(marca.nome) ?? nomeReserva,
    razao_social: null,
    cnpj: documento ? formatarDocumento(documento) : null,
    inscricao_estadual: null,
    slogan: null,
    endereco: semEspaco(marca.endereco),
    bairro: null,
    cidade: semEspaco(marca.cidade),
    estado: semEspaco(marca.estado),
    cep: null,
    telefones: telefone ? formatarTelefone(telefone) : null,
    email: semEspaco(marca.email),
    // o rodapé do documento imprime o site: vazio para não sair o de ninguém
    site: null,
    logo_url: logoUrl,
    cor: /^#[0-9a-fA-F]{6}$/.test(marca.cor ?? "") ? marca.cor : COR_PADRAO_DA_MARCA,
    condicoes_gerais: semEspaco(marca.rodape) ?? CONDICOES_PADRAO,
  };
}

const dataBr = (d: Date | null) => (d ? d.toLocaleDateString("pt-BR") : null);

export function propsDoOrcamentoDoParceiro(params: {
  orcamento: OrcamentoDoParceiro;
  itens: ItemDoOrcamento[];
  catalogo: Map<string, ItemDoCatalogo>;
  marca: MarcaDoParceiro;
  nomeDoParceiro: string;
  logoUrl: string | null;
}): DocumentoPDFProps {
  const { orcamento, itens, catalogo, marca, nomeDoParceiro, logoUrl } = params;
  const empresa = empresaDoParceiro(marca, nomeDoParceiro, logoUrl);

  const docItens: DocItem[] = itens.map((item) => {
    const produto = item.produto_id ? catalogo.get(item.produto_id) : undefined;
    const venda = vendaDoItem(item, produto);
    const porArea = vendidoPorArea(item, produto);
    const dimensionado = temDimensoes(item);
    return {
      descricao: item.descricao,
      unidade: porArea ? "m²" : unidadeLegivel(item.unidade),
      quantidade: Number(item.quantidade),
      largura: dimensionado ? Number(item.largura) : null,
      altura: dimensionado ? Number(item.altura) : null,
      area_total: dimensionado
        ? Math.round(Number(item.largura) * Number(item.altura) * Math.max(Number(item.quantidade), 1) * 1000) / 1000
        : null,
      acabamento: semEspaco(item.acabamento),
      valor_unitario: venda.unitario,
      valor_total: venda.total,
    };
  });

  const total = Math.round(docItens.reduce((s, i) => s + i.valor_total, 0) * 100) / 100;
  const somaArea = docItens.reduce((s, i) => s + (i.area_total ?? 0), 0);
  const criado = new Date(orcamento.created_at);

  return {
    tipo: "orcamento",
    numero: orcamento.numero,
    data_solicitacao: dataBr(Number.isNaN(criado.getTime()) ? null : criado),
    data_validade: dataBr(validadeDoOrcamento(orcamento.created_at, orcamento.validade_dias)),
    vendedor: empresa.nome,
    status: null,
    empresa,
    cliente: {
      nome: orcamento.cliente_nome,
      documento: semEspaco(orcamento.cliente_documento)
        ? formatarDocumento(orcamento.cliente_documento as string)
        : null,
      telefone: semEspaco(orcamento.cliente_telefone)
        ? formatarTelefone(orcamento.cliente_telefone as string)
        : null,
      email: semEspaco(orcamento.cliente_email),
    },
    itens: docItens,
    soma_area: somaArea > 0 ? Math.round(somaArea * 1000) / 1000 : null,
    subtotal: total,
    desconto: 0,
    total,
    pagamento: null,
    entrega: null,
    observacoes: semEspaco(orcamento.observacoes),
    mostrarValores: true,
  };
}

/** "Orcamento-12-padaria-do-ze.pdf" — sem acento, que atrapalha no WhatsApp. */
export function nomeDoArquivo(orcamento: Pick<OrcamentoDoParceiro, "numero" | "cliente_nome">): string {
  const cliente = orcamento.cliente_nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `Orcamento-${orcamento.numero}${cliente ? `-${cliente}` : ""}.pdf`;
}
