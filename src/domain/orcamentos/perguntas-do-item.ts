import { alternarAcabamento, temAcabamento } from "@/domain/orcamentos/tipos-de-produto";

/**
 * As perguntas do produto dentro do item do orçamento (02/11/2026), no jeito do
 * Holdprint: "O adesivo deverá ser aplicado por nós?", "Qual o acabamento do
 * banner?", "Deseja incluir o suporte?". O cadastro das perguntas é a aba
 * Checklist da pasta do produto (`produto_perguntas`, #330); aqui elas são
 * respondidas e a resposta fica gravada no item (`orcamento_itens.respostas`).
 *
 * Uma ação "se a resposta for X, acrescenta o processo Y" entra no texto de
 * acabamento do item, que já vai para a OS e para o PDF. Ela NÃO mexe no preço
 * por enquanto: a produtividade dos processos está vazia de propósito (número
 * de palpite faz orçar errado), então o que a resposta faz é avisar a produção
 * e lembrar quem vende de cobrar o serviço no item.
 */

export type TipoDeResposta = "unica" | "multipla" | "numero" | "texto";

export type PerguntaDoProduto = {
  id: string;
  pergunta: string;
  descricao: string | null;
  obrigatoria: boolean;
  tipo_resposta: TipoDeResposta;
  /** Opções, para `unica` e `multipla`. */
  respostas: string[];
  /** "Se a resposta for X, acrescenta o processo Y". */
  acoes: { resposta: string; processo_id: string }[];
  ordem: number;
};

export type RespostaDoItem = {
  pergunta_id: string;
  pergunta: string;
  /** `unica`, `numero` e `texto` gravam texto; `multipla` grava lista. */
  resposta: string | string[];
};

const textoLimpo = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A linha do banco como a tela usa; lixo nas listas vira lista vazia. */
export function perguntaDaLinha(l: Record<string, unknown>): PerguntaDoProduto {
  const tipo = String(l.tipo_resposta ?? "unica");
  const respostas = Array.isArray(l.respostas) ? l.respostas.map(textoLimpo).filter(Boolean) : [];
  const acoes = Array.isArray(l.acoes)
    ? l.acoes
        .map((a) => ({ resposta: textoLimpo((a as { resposta?: unknown })?.resposta), processo_id: textoLimpo((a as { processo_id?: unknown })?.processo_id) }))
        .filter((a) => a.resposta && a.processo_id)
    : [];
  return {
    id: String(l.id ?? ""),
    pergunta: textoLimpo(l.pergunta),
    descricao: textoLimpo(l.descricao) || null,
    obrigatoria: l.obrigatoria !== false,
    tipo_resposta: (["unica", "multipla", "numero", "texto"].includes(tipo) ? tipo : "unica") as TipoDeResposta,
    respostas,
    acoes,
    ordem: Number(l.ordem ?? 0) || 0,
  };
}

/** O que veio gravado no item; qualquer coisa fora do formato vira lista vazia. */
export function normalizarRespostas(valor: unknown): RespostaDoItem[] {
  if (!Array.isArray(valor)) return [];
  const saida: RespostaDoItem[] = [];
  for (const r of valor as { pergunta_id?: unknown; pergunta?: unknown; resposta?: unknown }[]) {
    const id = textoLimpo(r?.pergunta_id);
    if (!id) continue;
    const resposta = Array.isArray(r.resposta)
      ? r.resposta.map(textoLimpo).filter(Boolean)
      : typeof r.resposta === "number"
        ? String(r.resposta)
        : textoLimpo(r.resposta);
    saida.push({ pergunta_id: id, pergunta: textoLimpo(r.pergunta), resposta });
  }
  return saida;
}

export function respondida(r: RespostaDoItem | undefined): boolean {
  if (!r) return false;
  return Array.isArray(r.resposta) ? r.resposta.length > 0 : r.resposta.trim() !== "";
}

export function respostaDe(respostas: readonly RespostaDoItem[], perguntaId: string): RespostaDoItem | undefined {
  return respostas.find((r) => r.pergunta_id === perguntaId);
}

/** Troca (ou cria) a resposta de uma pergunta; resposta vazia tira a linha. */
export function responder(
  respostas: readonly RespostaDoItem[],
  pergunta: PerguntaDoProduto,
  resposta: string | string[],
): RespostaDoItem[] {
  const semEla = respostas.filter((r) => r.pergunta_id !== pergunta.id);
  const nova: RespostaDoItem = { pergunta_id: pergunta.id, pergunta: pergunta.pergunta, resposta };
  return respondida(nova) ? [...semEla, nova] : semEla;
}

/** As obrigatórias ainda sem resposta, na ordem do cadastro. */
export function pendenciasDasRespostas(
  perguntas: readonly PerguntaDoProduto[],
  respostas: readonly RespostaDoItem[],
): PerguntaDoProduto[] {
  return perguntas.filter((p) => p.obrigatoria && !respondida(respostaDe(respostas, p.id)));
}

/** Os processos que as respostas dadas acrescentam (ids, sem repetir). */
export function processosDasRespostas(
  perguntas: readonly PerguntaDoProduto[],
  respostas: readonly RespostaDoItem[],
): string[] {
  const ids = new Set<string>();
  for (const p of perguntas) {
    const r = respostaDe(respostas, p.id);
    if (!respondida(r)) continue;
    const dadas = Array.isArray(r!.resposta) ? r!.resposta : [r!.resposta];
    for (const a of p.acoes) if (dadas.includes(a.resposta)) ids.add(a.processo_id);
  }
  return [...ids];
}

/**
 * O texto de acabamento depois de uma resposta mudar: tira os processos que a
 * resposta anterior acrescentava e não valem mais, põe os novos. O que a
 * pessoa escreveu à mão fica.
 */
export function acabamentoAjustado(
  atual: string,
  nomesAntes: readonly string[],
  nomesDepois: readonly string[],
): string {
  let texto = atual;
  for (const n of nomesAntes) if (!nomesDepois.includes(n) && temAcabamento(texto, n)) texto = alternarAcabamento(texto, n);
  for (const n of nomesDepois) if (!temAcabamento(texto, n)) texto = alternarAcabamento(texto, n);
  return texto;
}

/** "Aplicado por nós: Sim · Embalagem: Caixa", para o resumo do item. */
export function resumoDasRespostas(respostas: readonly RespostaDoItem[]): string {
  return respostas
    .filter(respondida)
    .map((r) => `${r.pergunta}: ${Array.isArray(r.resposta) ? r.resposta.join(", ") : r.resposta}`)
    .join(" · ");
}
