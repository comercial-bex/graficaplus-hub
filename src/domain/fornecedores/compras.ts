/**
 * O que foi comprado em cada fornecedor — as contas da tela Fornecedores.
 *
 * O documento é guardado como o fornecedor emitiu (`compras_fornecedor`):
 * VENDA é compra faturada; RESERVA é pedido separado e pago que, no sistema
 * dele, não virou venda (sem nota); DEVOLUÇÃO desfaz uma venda e vem com total
 * negativo. Por isso o "total pago" é a soma simples dos totais pagos.
 *
 * Estas contas não mexem em estoque, caixa nem custo do material: comparam o
 * preço pago com o custo do cadastro para quem decide.
 */

export type TipoDoDocumento = "venda" | "reserva" | "devolucao";
export type Finalidade = "materia_prima" | "tinta" | "ferramenta" | "consumo" | "outro";
export type CategoriaDoFornecedor =
  | "tintas"
  | "materia_prima"
  | "insumos"
  | "ferramentas"
  | "equipamentos"
  | "brindes"
  | "servicos"
  | "outros";

export type ItemDaCompra = {
  id: string;
  ordem: number;
  codigo: string | null;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  preco_lista: number | null;
  desconto_pct: number | null;
  preco_unitario: number;
  total: number;
  finalidade: Finalidade;
  material_id: string | null;
  /** Quanto do material do estoque uma unidade comprada rende (rolo 1,06 × 50 = 53 m²). */
  rende_do_material: number | null;
};

export type CompraNoFornecedor = {
  id: string;
  fornecedor_id: string;
  documento: string;
  tipo: TipoDoDocumento;
  data_operacao: string;
  comprador_nome: string;
  comprador_cnpj: string | null;
  codigo_cliente: string | null;
  forma_pagamento: string | null;
  condicao_pagamento: string | null;
  pago: boolean;
  total_bruto: number;
  desconto: number;
  total: number;
  devolve_compra_id: string | null;
  observacoes: string | null;
  fonte: string | null;
  itens: ItemDaCompra[];
};

export type MaterialDoCadastro = {
  id: string;
  nome: string;
  unidade: string;
  custo_medio: number | null;
  custo_unitario: number | null;
};

export const CATEGORIAS: { valor: CategoriaDoFornecedor; rotulo: string }[] = [
  { valor: "tintas", rotulo: "Tintas" },
  { valor: "materia_prima", rotulo: "Matéria-prima" },
  { valor: "insumos", rotulo: "Insumos" },
  { valor: "ferramentas", rotulo: "Ferramentas" },
  { valor: "equipamentos", rotulo: "Equipamentos" },
  { valor: "brindes", rotulo: "Brindes" },
  { valor: "servicos", rotulo: "Serviços" },
  { valor: "outros", rotulo: "Outros" },
];

export const ROTULO_DA_FINALIDADE: Record<Finalidade, string> = {
  materia_prima: "Matéria-prima",
  tinta: "Tinta",
  ferramenta: "Ferramentas",
  consumo: "Consumo (copa)",
  outro: "Outros",
};

export const ROTULO_DO_TIPO: Record<TipoDoDocumento, string> = {
  venda: "Venda",
  reserva: "Reserva",
  devolucao: "Devolução",
};

const REAL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brl = (v: number | null | undefined) => (v == null ? "—" : REAL.format(v));

/** Dinheiro em centavos inteiros: soma de numeric(12,2) sem erro de ponto flutuante. */
const centavos = (v: number) => Math.round(Number(v) * 100);
const reais = (c: number) => c / 100;

export type Situacao = "comprado" | "devolvido" | "devolucao" | "reserva_paga" | "reserva_em_aberto" | "nao_pago";

/** O que aconteceu com o documento, olhando os outros (a devolução aponta para a venda). */
export function situacaoDoDocumento(doc: CompraNoFornecedor, todos: CompraNoFornecedor[]): Situacao {
  if (doc.tipo === "devolucao") return "devolucao";
  if (doc.tipo === "reserva") return doc.pago ? "reserva_paga" : "reserva_em_aberto";
  if (todos.some((d) => d.tipo === "devolucao" && d.devolve_compra_id === doc.id)) return "devolvido";
  return doc.pago ? "comprado" : "nao_pago";
}

export const ROTULO_DA_SITUACAO: Record<Situacao, string> = {
  comprado: "Comprado",
  devolvido: "Devolvido",
  devolucao: "Devolução",
  reserva_paga: "Reserva paga — sem nota",
  reserva_em_aberto: "Reserva em aberto",
  nao_pago: "Não pago",
};

export type ResumoDasCompras = {
  /** Vendas pagas, inclusive as que depois foram devolvidas. */
  vendas: number;
  /** Quanto voltou em devolução (positivo). */
  devolvido: number;
  /** Reservas pagas que não viraram venda no fornecedor. */
  reservasPagas: number;
  /** O que de fato saiu: vendas − devoluções + reservas pagas. */
  totalPago: number;
  documentos: number;
  porComprador: { nome: string; cnpj: string | null; total: number }[];
  porFinalidade: { finalidade: Finalidade; total: number }[];
};

export function resumoDasCompras(docs: CompraNoFornecedor[]): ResumoDasCompras {
  const pagos = docs.filter((d) => d.pago);
  let vendas = 0;
  let devolvido = 0;
  let reservas = 0;
  const comprador = new Map<string, { nome: string; cnpj: string | null; c: number }>();
  const finalidade = new Map<Finalidade, number>();
  for (const d of pagos) {
    const c = centavos(d.total);
    if (d.tipo === "venda") vendas += c;
    else if (d.tipo === "devolucao") devolvido += -c;
    else reservas += c;
    const chave = d.comprador_cnpj ?? d.comprador_nome;
    const atual = comprador.get(chave) ?? { nome: d.comprador_nome, cnpj: d.comprador_cnpj, c: 0 };
    atual.c += c;
    comprador.set(chave, atual);
    for (const i of d.itens) finalidade.set(i.finalidade, (finalidade.get(i.finalidade) ?? 0) + centavos(i.total));
  }
  return {
    vendas: reais(vendas),
    devolvido: reais(devolvido),
    reservasPagas: reais(reservas),
    totalPago: reais(vendas - devolvido + reservas),
    documentos: docs.length,
    porComprador: [...comprador.values()]
      .map((x) => ({ nome: x.nome, cnpj: x.cnpj, total: reais(x.c) }))
      .sort((a, b) => b.total - a.total),
    porFinalidade: [...finalidade.entries()]
      .map(([f, c]) => ({ finalidade: f, total: reais(c) }))
      .filter((x) => x.total !== 0)
      .sort((a, b) => b.total - a.total),
  };
}

/** Preço pago por unidade do MATERIAL (R$/m², R$/ml): rolo de R$ 340 que rende 53 m² → R$ 6,42/m². */
export function precoPorUnidadeDoMaterial(item: ItemDaCompra): number | null {
  if (!item.material_id || !item.rende_do_material || item.rende_do_material <= 0) return null;
  if (item.quantidade <= 0) return null;
  return item.preco_unitario / item.rende_do_material;
}

export type PrecoPagoDoMaterial = {
  material: MaterialDoCadastro;
  /** O último preço pago por unidade do material (por data do documento). */
  ultimoPago: number;
  ultimoDocumento: string;
  ultimaData: string;
  menorPago: number;
  maiorPago: number;
  /** Custo que o sistema usa hoje (custo médio; sem ele, o custo unitário). */
  custoNoCadastro: number | null;
  /** (custo do cadastro − último pago) ÷ último pago. Positivo: o cadastro está acima do que se paga. */
  diferenca: number | null;
};

/**
 * Para cada material do estoque que aparece nas compras: o último preço pago,
 * a faixa e quanto o custo do cadastro está longe dele. Devolução e documento
 * não pago ficam de fora — não são preço de compra.
 */
export function precosPagosPorMaterial(
  docs: CompraNoFornecedor[],
  materiais: MaterialDoCadastro[],
): PrecoPagoDoMaterial[] {
  const porId = new Map(materiais.map((m) => [m.id, m]));
  const vistos = new Map<string, { preco: number; documento: string; data: string }[]>();
  for (const d of docs) {
    if (!d.pago || d.tipo === "devolucao") continue;
    for (const i of d.itens) {
      const p = precoPorUnidadeDoMaterial(i);
      if (p == null || !i.material_id) continue;
      const lista = vistos.get(i.material_id) ?? [];
      lista.push({ preco: p, documento: d.documento, data: d.data_operacao });
      vistos.set(i.material_id, lista);
    }
  }
  const linhas: PrecoPagoDoMaterial[] = [];
  for (const [id, lista] of vistos) {
    const material = porId.get(id);
    if (!material) continue;
    const ordenada = [...lista].sort((a, b) => a.data.localeCompare(b.data));
    const ultimo = ordenada[ordenada.length - 1];
    const custo = material.custo_medio ?? material.custo_unitario ?? null;
    linhas.push({
      material,
      ultimoPago: ultimo.preco,
      ultimoDocumento: ultimo.documento,
      ultimaData: ultimo.data,
      menorPago: Math.min(...lista.map((x) => x.preco)),
      maiorPago: Math.max(...lista.map((x) => x.preco)),
      custoNoCadastro: custo,
      diferenca: custo == null || ultimo.preco === 0 ? null : (custo - ultimo.preco) / ultimo.preco,
    });
  }
  return linhas.sort((a, b) => a.material.nome.localeCompare(b.material.nome, "pt-BR"));
}

/** Preço por unidade do material com casas que fazem sentido: R$ 0,2317/ml, R$ 6,42/m². */
export function formatarPrecoDaUnidade(valor: number, unidade: string): string {
  const casas = valor < 1 ? 4 : 2;
  const numero = valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return `R$ ${numero}/${unidade}`;
}
