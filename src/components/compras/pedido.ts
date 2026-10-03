/**
 * Regras do pedido de compra que a tela precisa antes de chamar o banco.
 *
 * O banco confere tudo de novo — `salvar_pedido_compra`, `receber_pedido_compra`
 * e `cancelar_pedido_compra` recusam o que estiver errado, com a mesma frase.
 * Mas a tela precisa somar o total enquanto a pessoa digita, apontar a linha
 * errada sem ida ao servidor e saber, por pedido, quais botões fazem sentido.
 * Botão que aparece e o banco recusa é a mesma mentira que botão que finge que
 * fez.
 */

export type StatusDoPedido = "rascunho" | "enviado" | "recebido_parcial" | "recebido" | "cancelado";

export const ROTULO_STATUS: Record<StatusDoPedido, string> = {
  rascunho: "rascunho",
  enviado: "aguardando entrega",
  recebido_parcial: "recebido em parte",
  recebido: "recebido",
  cancelado: "cancelado",
};

/** Os que ainda pedem ação de alguém: revisar, receber ou cancelar. */
export function emAberto(status: string): boolean {
  return status === "rascunho" || status === "enviado" || status === "recebido_parcial";
}

/** Uma linha do formulário, como a pessoa digitou. */
export type LinhaDoPedido = {
  chave: string;
  material_id: string;
  quantidade: string;
  custo_unitario: string;
};

export type ItemParaGravar = { material_id: string; quantidade: number; custo_unitario: number };

/** Um item gravado, como vem de `pedido_compra_itens`. */
export type ItemDoPedido = {
  id: string;
  material_id: string;
  quantidade: number | string;
  quantidade_recebida: number | string;
  custo_unitario: number | string;
  material?: { nome: string; unidade: string | null } | null;
};

/** Um pedido como a lista lê: cabeçalho de `pedidos_compra` e os itens embutidos. */
export type PedidoDeCompra = {
  id: string;
  numero: number;
  fornecedor: string;
  status: StatusDoPedido;
  previsao_entrega: string | null;
  observacoes: string | null;
  os_id: string | null;
  created_at: string;
  pedido_compra_itens: ItemDoPedido[];
};

/**
 * Colunas que a lista pede. `material:material_id(...)` embute a linha de
 * `materiais` pela chave estrangeira — só nome e unidade, que a equipe pode
 * ler (o custo do material fica de fora; o custo que aparece é o do pedido).
 */
export const SELECT_DO_PEDIDO =
  "id, numero, fornecedor, status, previsao_entrega, observacoes, os_id, created_at, " +
  "pedido_compra_itens(id, material_id, quantidade, quantidade_recebida, custo_unitario, material:material_id(nome, unidade))";

/** Um material na hora de pedir. Custo e fornecedor só vêm na visão financeira. */
export type MaterialParaCompra = {
  id: string;
  nome: string;
  unidade: string | null;
  estoque: number | string | null;
  estoque_minimo: number | string | null;
  custo_medio?: number | string | null;
  custo_unitario?: number | string | null;
  fornecedor?: string | null;
};

/**
 * Palpite de custo para a linha nova: o da última compra (é o que o
 * fornecedor cobrou da última vez); sem ele, o médio. Sem nenhum, em branco —
 * a pessoa digita o da cotação.
 */
export function custoSugerido(m: Pick<MaterialParaCompra, "custo_unitario" | "custo_medio"> | undefined): string {
  if (!m) return "";
  const ultimo = Number(m.custo_unitario);
  if (Number.isFinite(ultimo) && ultimo > 0) return String(ultimo);
  const medio = Number(m.custo_medio);
  return Number.isFinite(medio) && medio > 0 ? String(medio) : "";
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const qtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

/**
 * Número de um campo do formulário. Vazio e ilegível voltam `null`, nunca 0:
 * quantidade zero e quantidade em branco pedem respostas diferentes.
 */
export function numeroDoCampo(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().replace(",", ".");
  if (texto === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

const linhaEmBranco = (l: LinhaDoPedido) =>
  !l.material_id && !l.quantidade.trim() && !l.custo_unitario.trim();

export function subtotalDaLinha(l: LinhaDoPedido): number {
  const q = numeroDoCampo(l.quantidade);
  const c = numeroDoCampo(l.custo_unitario);
  return q !== null && c !== null && q > 0 && c >= 0 ? r2(q * c) : 0;
}

/** Total do que está no formulário, linha a linha, como o banco vai somar. */
export function totalDoFormulario(linhas: LinhaDoPedido[]): number {
  return r2(linhas.reduce((s, l) => s + subtotalDaLinha(l), 0));
}

/** Total do pedido gravado. */
export function totalDoPedido(itens: Pick<ItemDoPedido, "quantidade" | "custo_unitario">[]): number {
  return r2(itens.reduce((s, i) => s + num(i.quantidade) * num(i.custo_unitario), 0));
}

/**
 * Quanto ainda falta chegar. Arredonda na 4ª casa, a escala da coluna
 * (numeric(14,4)): sem isso 0,3 − 0,1 dá 0,19999… e recusaria quem informa 0,2.
 */
export function faltaReceber(i: Pick<ItemDoPedido, "quantidade" | "quantidade_recebida">): number {
  return Math.max(0, Math.round((num(i.quantidade) - num(i.quantidade_recebida)) * 10000) / 10000);
}

/**
 * Confere o formulário com as mesmas regras de `salvar_pedido_compra`.
 *
 * Linha totalmente em branco é ignorada (é a linha nova que a pessoa ainda
 * não usou); linha começada e incompleta vira problema com o nome do
 * material, para a pessoa achar qual é.
 */
export function conferirPedido(entrada: {
  fornecedor: string;
  linhas: LinhaDoPedido[];
  /** true = registrar o pedido (enviado); false = guardar como rascunho */
  registrar: boolean;
  nomeDe: (materialId: string) => string;
}): { itens: ItemParaGravar[]; problemas: string[] } {
  const problemas: string[] = [];
  const itens: ItemParaGravar[] = [];
  const fornecedor = entrada.fornecedor.trim();

  if (!fornecedor) problemas.push("Informe o fornecedor.");
  else if (entrada.registrar && fornecedor.toLowerCase() === "a definir") {
    problemas.push("Defina o fornecedor antes de registrar o pedido.");
  }

  const vistos = new Set<string>();
  entrada.linhas.forEach((l, i) => {
    if (linhaEmBranco(l)) return;
    if (!l.material_id) {
      problemas.push(`Escolha o material da linha ${i + 1}.`);
      return;
    }
    const nome = entrada.nomeDe(l.material_id);
    if (vistos.has(l.material_id)) {
      problemas.push(`O material ${nome} aparece duas vezes. Junte as quantidades numa linha só.`);
      return;
    }
    vistos.add(l.material_id);
    const q = numeroDoCampo(l.quantidade);
    const c = numeroDoCampo(l.custo_unitario);
    if (q === null || q <= 0) problemas.push(`Informe a quantidade de ${nome}.`);
    if (c === null || c < 0) problemas.push(`Informe o custo unitário de ${nome}.`);
    if (q !== null && q > 0 && c !== null && c >= 0) {
      itens.push({ material_id: l.material_id, quantidade: q, custo_unitario: c });
    }
  });

  if (itens.length === 0 && problemas.length === 0) {
    problemas.push("O pedido precisa de pelo menos um material.");
  }
  return { itens, problemas };
}

/** As linhas do formulário a partir de um pedido gravado (para revisar ou editar). */
export function linhasDoPedido(itens: ItemDoPedido[], novaChave: () => string): LinhaDoPedido[] {
  return itens.map((i) => ({
    chave: novaChave(),
    material_id: i.material_id,
    quantidade: String(num(i.quantidade)),
    custo_unitario: String(num(i.custo_unitario)),
  }));
}

export type PermissoesDeCompra = {
  /** compras.create */
  criar: boolean;
  /** compras.receive */
  receber: boolean;
  /** estoque.entry — a entrada no estoque, que o recebimento faz por dentro */
  darEntrada: boolean;
  /** compras.cancel */
  cancelar: boolean;
};

export type AcoesDoPedido = {
  /** rascunho: conferir fornecedor e custos e registrar */
  revisar: boolean;
  /** pedido registrado em que nada chegou ainda */
  editar: boolean;
  receber: boolean;
  /** quem tem compras.receive mas não estoque.entry: o porquê, em vez do botão */
  receberBloqueado: string | null;
  cancelar: boolean;
};

export const SEM_ENTRADA_NO_ESTOQUE =
  "Receber dá entrada no estoque, e isso exige a permissão estoque.entry (hoje de admin e estoque).";

/** Os botões que fazem sentido para este pedido e para quem está olhando. */
export function acoesDoPedido(
  pedido: { status: string; itens: Pick<ItemDoPedido, "quantidade" | "quantidade_recebida">[] },
  perm: PermissoesDeCompra,
): AcoesDoPedido {
  const algoChegou = pedido.itens.some((i) => num(i.quantidade_recebida) > 0);
  const temPendente = pedido.itens.some((i) => faltaReceber(i) > 0);
  // Rascunho NÃO se recebe: pode estar com fornecedor "A definir", e a entrada
  // grava o fornecedor no lote e no cadastro do material. O banco recusa também.
  const esperando = (pedido.status === "enviado" || pedido.status === "recebido_parcial") && temPendente;
  return {
    revisar: perm.criar && pedido.status === "rascunho",
    editar: perm.criar && pedido.status === "enviado" && !algoChegou,
    receber: perm.receber && perm.darEntrada && esperando,
    receberBloqueado: perm.receber && !perm.darEntrada && esperando ? SEM_ENTRADA_NO_ESTOQUE : null,
    cancelar: perm.cancelar && emAberto(pedido.status),
  };
}

/** Uma linha do diálogo de recebimento. Custo em branco = custo do pedido. */
export type LinhaDeRecebimento = { item_id: string; quantidade: string; custo_unitario: string };

export type ItemRecebido = { item_id: string; quantidade: number; custo_unitario?: number };

/**
 * Confere o recebimento com as mesmas regras de `receber_pedido_compra`.
 *
 * Linha com zero ou em branco não chegou desta vez — recebimento parcial é a
 * regra. Chegar MAIS do que falta é recusado com o material e a unidade.
 */
export function conferirRecebimento(
  linhas: LinhaDeRecebimento[],
  itens: ItemDoPedido[],
): { itens: ItemRecebido[]; problemas: string[] } {
  const porId = new Map(itens.map((i) => [i.id, i]));
  const recebidos: ItemRecebido[] = [];
  const problemas: string[] = [];

  for (const l of linhas) {
    const item = porId.get(l.item_id);
    if (!item) continue;
    const nome = item.material?.nome ?? "material";
    const unidade = item.material?.unidade ?? "un";
    const q = numeroDoCampo(l.quantidade);
    if (q === null || q === 0) continue;
    if (q < 0) {
      problemas.push(`A quantidade de ${nome} não pode ser negativa.`);
      continue;
    }
    const falta = faltaReceber(item);
    if (q > falta) {
      problemas.push(
        `De ${nome}, faltam ${qtd(falta)} ${unidade} neste pedido e foram informados ${qtd(q)} ${unidade}.`,
      );
      continue;
    }
    const c = numeroDoCampo(l.custo_unitario);
    if (c !== null && c < 0) {
      problemas.push(`O custo de ${nome} não pode ser negativo.`);
      continue;
    }
    recebidos.push(c === null ? { item_id: l.item_id, quantidade: q } : { item_id: l.item_id, quantidade: q, custo_unitario: c });
  }

  if (recebidos.length === 0 && problemas.length === 0) {
    problemas.push("Informe a quantidade que chegou de pelo menos um item.");
  }
  return { itens: recebidos, problemas };
}

/** O recebimento já preenchido com tudo o que falta: o caso comum é chegar tudo. */
export function recebimentoCompleto(itens: ItemDoPedido[]): LinhaDeRecebimento[] {
  return itens
    .filter((i) => faltaReceber(i) > 0)
    .map((i) => ({ item_id: i.id, quantidade: String(faltaReceber(i)), custo_unitario: "" }));
}
