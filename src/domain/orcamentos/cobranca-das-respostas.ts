import { quantidadeDoAcabamento, type MedidaCobrada } from "@/domain/orcamentos/cobranca-do-acabamento";
import {
  respondida,
  respostaDe,
  type PerguntaDoProduto,
  type RespostaDoItem,
} from "@/domain/orcamentos/perguntas-do-item";

/**
 * O que cada resposta do item cobra (02/11/2026). A resposta acrescenta um processo; o processo diz qual
 * serviço o cobra e em que medida. A cobrança vira uma linha do orçamento presa ao item
 * (`orcamento_itens.gerado_por_item_id`): mudar a resposta para "Não" tira a linha.
 *
 * Horas e km não saem da medida da peça. Sem a informação a linha não entra e a tela diz: cobrar um número de
 * palpite faz orçar errado do mesmo jeito.
 */

export type MedidaDaResposta = MedidaCobrada | "informar";

export type ProcessoDaResposta = {
  id: string;
  nome: string;
  medida_cobrada: MedidaDaResposta | null;
  produto_servico_id: string | null;
};

export type ServicoDaResposta = {
  id: string;
  nome: string;
  unidade: string;
  preco_base?: number | string | null;
};

export type LinhaDoOrcamento = {
  id: string;
  produto_id?: string | null;
  quantidade?: number | string | null;
  gerado_por_item_id?: string | null;
};

export type EstadoDaCobranca =
  /** Entra no orçamento ao salvar o item. */
  | "cobra"
  /** Precisa de horas ou km. */
  | "falta_quantidade"
  /** Precisa da medida da peça. */
  | "falta_medida"
  /** O processo não tem serviço com preço. */
  | "sem_preco"
  /** Outra linha do orçamento já cobra este serviço. */
  | "ja_no_orcamento";

export type CobrancaDaResposta = {
  processo_id: string;
  nome: string;
  estado: EstadoDaCobranca;
  medida: MedidaDaResposta | null;
  servico: ServicoDaResposta | null;
  quantidade: number;
  preco: number;
  total: number;
};

const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Os processos que as respostas acrescentam, na ordem das perguntas e sem repetir. */
function processosNaOrdem(perguntas: readonly PerguntaDoProduto[], respostas: readonly RespostaDoItem[]): string[] {
  const ids: string[] = [];
  for (const p of perguntas) {
    const r = respostaDe(respostas, p.id);
    if (!r || !respondida(r)) continue;
    const dadas = Array.isArray(r.resposta) ? r.resposta : [r.resposta];
    for (const a of p.acoes) if (dadas.includes(a.resposta) && !ids.includes(a.processo_id)) ids.push(a.processo_id);
  }
  return ids;
}

export function cobrancasDasRespostas(a: {
  perguntas: readonly PerguntaDoProduto[];
  respostas: readonly RespostaDoItem[];
  processos: readonly ProcessoDaResposta[];
  servicos: readonly ServicoDaResposta[];
  peca: { largura: number; altura: number; quantidade: number };
  /** Horas e km digitados, por processo. */
  informadas: Readonly<Record<string, number>>;
  linhasDoOrcamento: readonly LinhaDoOrcamento[];
  /** O item em edição; nulo para item novo. */
  itemAtualId: string | null;
}): CobrancaDaResposta[] {
  const saida: CobrancaDaResposta[] = [];
  for (const id of processosNaOrdem(a.perguntas, a.respostas)) {
    const processo = a.processos.find((p) => p.id === id);
    if (!processo) continue;
    const medida = processo.medida_cobrada;
    const servico = a.servicos.find((s) => s.id === processo.produto_servico_id) ?? null;
    const preco = Number(servico?.preco_base);
    const base = { processo_id: id, nome: processo.nome, medida, servico, quantidade: 0, preco: 0, total: 0 };
    if (!servico || !medida || !(preco > 0)) {
      saida.push({ ...base, estado: "sem_preco" });
      continue;
    }
    // Instalação e deslocamento são do serviço inteiro: duas peças na mesma visita não cobram duas vezes.
    // Laminação é de cada peça: a linha de outro item não conta; a digitada à mão, sim.
    const repetida = a.linhasDoOrcamento.some(
      (l) =>
        l.id !== a.itemAtualId &&
        l.produto_id === servico.id &&
        (a.itemAtualId === null || l.gerado_por_item_id !== a.itemAtualId) &&
        (medida === "informar" || !l.gerado_por_item_id),
    );
    if (repetida) {
      saida.push({ ...base, preco, estado: "ja_no_orcamento" });
      continue;
    }
    const quantidade =
      medida === "informar" ? Number(a.informadas[id] ?? 0) : quantidadeDoAcabamento(medida, a.peca);
    if (!(quantidade > 0)) {
      saida.push({ ...base, preco, estado: medida === "informar" ? "falta_quantidade" : "falta_medida" });
      continue;
    }
    saida.push({ ...base, preco, quantidade, total: centavos(quantidade * preco), estado: "cobra" });
  }
  return saida;
}

export function totalDasCobrancas(c: readonly CobrancaDaResposta[]): number {
  return centavos(c.reduce((soma, l) => soma + (l.estado === "cobra" ? l.total : 0), 0));
}

export type PlanoDasLinhas = {
  inserir: CobrancaDaResposta[];
  atualizar: { id: string; quantidade: number }[];
  apagar: string[];
};

/** O que fazer nas linhas presas a um item para ficarem iguais ao que as respostas cobram. */
export function planoDasLinhas(
  cobrancas: readonly CobrancaDaResposta[],
  linhasDoItem: readonly LinhaDoOrcamento[],
): PlanoDasLinhas {
  const plano: PlanoDasLinhas = { inserir: [], atualizar: [], apagar: [] };
  const usadas = new Set<string>();
  for (const c of cobrancas) {
    if (c.estado !== "cobra" || !c.servico) continue;
    const linha = linhasDoItem.find((l) => l.produto_id === c.servico!.id);
    if (!linha) {
      plano.inserir.push(c);
      continue;
    }
    usadas.add(linha.id);
    if (Number(linha.quantidade) !== c.quantidade) plano.atualizar.push({ id: linha.id, quantidade: c.quantidade });
  }
  for (const l of linhasDoItem) if (!usadas.has(l.id)) plano.apagar.push(l.id);
  return plano;
}

/** O texto da linha: laminação diz de qual peça; instalação e deslocamento valem para o serviço todo. */
export function descricaoDaLinha(c: CobrancaDaResposta, descricaoDoItem: string): string {
  const nome = c.servico?.nome ?? c.nome;
  return c.medida === "informar" ? nome : `${nome}: ${descricaoDoItem.trim()}`;
}

/** Como pedir a quantidade na tela, pela unidade do serviço. */
export function rotuloDaQuantidade(unidade: string | null | undefined): string {
  const u = (unidade ?? "").trim().toLowerCase();
  if (u === "h" || u === "hora") return "Horas";
  if (u === "km") return "Km";
  return "Quantidade";
}
