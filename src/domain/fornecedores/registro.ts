/**
 * Registrar uma compra no fornecedor — as regras do formulário.
 *
 * O banco (`registrar_compra_fornecedor`) é quem decide: recalcula os totais e
 * recusa o que estiver errado. Aqui ficam as mesmas contas e os mesmos avisos,
 * para a pessoa ver o total e o problema ANTES de salvar.
 *
 * A pessoa digita a quantidade sempre positiva; na devolução o sinal é trocado
 * na hora de montar o pedido, como o fornecedor imprime.
 */
import type { Finalidade, TipoDoDocumento } from "@/domain/fornecedores/compras";

export type LinhaDaCompra = {
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: string;
  preco_lista: string;
  desconto_pct: string;
  /** Preço pago por unidade. Vazio = sai da tabela com o desconto. */
  preco_unitario: string;
  finalidade: Finalidade;
  material_id: string | null;
  /** Quanto do material do estoque uma unidade comprada rende (m², ml). */
  rende: string;
};

export type FormularioDaCompra = {
  tipo: TipoDoDocumento;
  numero: string;
  /** "AAAA-MM-DDTHH:MM", hora de Macapá (o campo datetime-local). */
  data: string;
  comprador_nome: string;
  comprador_cnpj: string;
  codigo_cliente: string;
  forma_pagamento: string;
  condicao_pagamento: string;
  pago: boolean;
  devolve_compra_id: string | null;
  observacoes: string;
  linhas: LinhaDaCompra[];
};

export const linhaVazia = (): LinhaDaCompra => ({
  codigo: "",
  descricao: "",
  unidade: "UN",
  quantidade: "1",
  preco_lista: "",
  desconto_pct: "",
  preco_unitario: "",
  finalidade: "materia_prima",
  material_id: null,
  rende: "",
});

const PREFIXO: Record<TipoDoDocumento, string> = { venda: "VENDA", reserva: "RESERVA", devolucao: "DEVOLUÇÃO" };

/** "VENDA 23500" — o mesmo jeito dos documentos que já estão registrados. */
export function documentoComTipo(tipo: TipoDoDocumento, numero: string): string {
  const n = numero.trim().replace(/^(venda|reserva|devolu[cç][aã]o)\s*/i, "");
  return `${PREFIXO[tipo]} ${n}`.trim();
}

/**
 * Número digitado em português: "1.234,56", "450,00", "0,2317" e "12.5".
 * Com vírgula, ponto é milhar; só com ponto, um ponto é decimal e vários são
 * milhar. Vazio ou lixo vira null.
 */
export function lerValor(texto: string | null | undefined): number | null {
  let t = String(texto ?? "").trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (t === "") return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const centavos = (v: number) => Math.round(v * 100);

/** Preço pago que sai da tabela com o desconto: R$ 450 com 20% → R$ 360,00. */
export function precoPeloDesconto(lista: number | null, desconto: number | null): number | null {
  if (lista == null) return null;
  return centavos(lista * (1 - (desconto ?? 0) / 100)) / 100;
}

/** O preço pago da linha: o digitado ou, sem ele, o da tabela com desconto. */
export function precoDaLinha(l: LinhaDaCompra): number | null {
  return lerValor(l.preco_unitario) ?? precoPeloDesconto(lerValor(l.preco_lista), lerValor(l.desconto_pct));
}

export type TotaisDaCompra = { bruto: number; desconto: number; total: number };

/** As mesmas contas do banco: total = Σ qtd × preço pago; bruto pela tabela; devolução sem desconto. */
export function totaisDaCompra(f: Pick<FormularioDaCompra, "tipo" | "linhas">): TotaisDaCompra {
  const sinal = f.tipo === "devolucao" ? -1 : 1;
  let total = 0;
  let bruto = 0;
  for (const l of f.linhas) {
    const qtd = lerValor(l.quantidade);
    const preco = precoDaLinha(l);
    if (qtd == null || preco == null) continue;
    const q = sinal * Math.abs(qtd);
    total += centavos(q * preco);
    bruto += centavos(q * (lerValor(l.preco_lista) ?? preco));
  }
  if (f.tipo === "devolucao") bruto = total;
  return { bruto: bruto / 100, desconto: (bruto - total) / 100, total: total / 100 };
}

/** Rolo de 1,06 × 50 m = 53 m²; litro = 1.000 ml. Sem como saber, null. */
export function rendeSugerido(material: {
  unidade: string;
  largura_bobina_m?: number | null;
  comprimento_bobina_m?: number | null;
}): number | null {
  const u = material.unidade.trim().toLowerCase();
  if ((u === "m²" || u === "m2") && material.largura_bobina_m && material.comprimento_bobina_m) {
    return Math.round(material.largura_bobina_m * material.comprimento_bobina_m * 1000) / 1000;
  }
  if (u === "ml") return 1000;
  return null;
}

/** O que impede salvar, na língua da tela. Vazio = pode salvar. */
export function problemasDaCompra(f: FormularioDaCompra, agora: Date = new Date()): string[] {
  const p: string[] = [];
  if (!f.numero.trim()) p.push("Informe o número do documento do fornecedor.");
  if (!f.data) p.push("Informe a data da compra.");
  else {
    const quando = new Date(`${f.data}:00-03:00`);
    if (Number.isNaN(quando.getTime())) p.push("A data da compra não é válida.");
    else if (quando.getTime() > agora.getTime() + 24 * 3600 * 1000) p.push("A data da compra está no futuro.");
  }
  if (!f.comprador_nome.trim()) p.push("Informe quem comprou (Bex Print ou Agência Bex).");
  if (f.tipo === "devolucao" && !f.devolve_compra_id) p.push("Escolha a venda que esta devolução desfaz.");
  if (f.linhas.length === 0) p.push("A compra precisa de pelo menos um item.");
  f.linhas.forEach((l, i) => {
    const n = i + 1;
    if (!l.descricao.trim()) p.push(`Item ${n}: falta a descrição.`);
    const qtd = lerValor(l.quantidade);
    if (qtd == null || qtd === 0) p.push(`Item ${n}: informe a quantidade.`);
    const preco = precoDaLinha(l);
    if (preco == null || preco < 0) p.push(`Item ${n}: informe o preço pago ou o de tabela.`);
    const desc = lerValor(l.desconto_pct);
    if (desc != null && (desc < 0 || desc > 100)) p.push(`Item ${n}: desconto entre 0 e 100%.`);
    if (l.material_id) {
      const rende = lerValor(l.rende);
      if (rende == null || rende <= 0) p.push(`Item ${n}: diga quanto do material uma unidade rende.`);
    }
  });
  return p;
}

/** O pedido para `registrar_compra_fornecedor`. Data na hora de Macapá (UTC−3). */
export function montarPedido(f: FormularioDaCompra, fornecedorId: string) {
  const sinal = f.tipo === "devolucao" ? -1 : 1;
  return {
    fornecedor_id: fornecedorId,
    documento: documentoComTipo(f.tipo, f.numero),
    tipo: f.tipo,
    data_operacao: `${f.data}:00-03:00`,
    comprador_nome: f.comprador_nome.trim(),
    comprador_cnpj: f.comprador_cnpj.trim() || null,
    codigo_cliente: f.codigo_cliente.trim() || null,
    forma_pagamento: f.forma_pagamento.trim() || null,
    condicao_pagamento: f.condicao_pagamento.trim() || null,
    pago: f.pago,
    devolve_compra_id: f.tipo === "devolucao" ? f.devolve_compra_id : null,
    observacoes: f.observacoes.trim() || null,
    itens: f.linhas.map((l) => ({
      codigo: l.codigo.trim() || null,
      descricao: l.descricao.trim(),
      unidade: l.unidade.trim() || null,
      quantidade: sinal * Math.abs(lerValor(l.quantidade) ?? 0),
      preco_lista: lerValor(l.preco_lista),
      desconto_pct: lerValor(l.desconto_pct),
      preco_unitario: precoDaLinha(l),
      finalidade: l.finalidade,
      material_id: l.material_id,
      rende_do_material: l.material_id ? lerValor(l.rende) : null,
    })),
  };
}

/** Agora em "AAAA-MM-DDTHH:MM" na hora de Macapá, para o campo de data. */
export function agoraEmMacapa(agora: Date = new Date()): string {
  const local = new Date(agora.getTime() - 3 * 3600 * 1000);
  return local.toISOString().slice(0, 16);
}
