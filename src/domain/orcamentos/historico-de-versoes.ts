/**
 * Histórico de versões do orçamento (17/11/2026): lê `orcamento_historico_de_versoes`, que devolve um array
 * da versão mais nova para a mais velha. Este arquivo normaliza o que vem do banco e escreve as frases da
 * tela em português simples. O contrato está em `docs/contrato-orcamentos-onda-1.md`.
 *
 * `[]` quer dizer "sem versões" e também "sem permissão para ver preço": a tela não distingue e usa texto
 * neutro. Função ausente ou erro de rede nunca vira estado vazio.
 */

export interface MudancaDaVersao {
  mudou: boolean;
  itens_novos: number;
  itens_tirados: number;
  itens_mudados: number;
  campos: string[];
  termos: string[];
  retrato_sem_itens: boolean;
}

export interface VersaoDoHistorico {
  id: string;
  numero: number;
  status: string;
  criada_em: string | null;
  enviada_em: string | null;
  aprovada_em: string | null;
  autor: string | null;
  valor_total: number;
  qtd_itens: number;
  retroativa: boolean;
  e_a_aprovada: boolean;
  o_que_mudou: MudancaDaVersao | null;
  valor_anterior: number | null;
}

export const TEXTO_SEM_VERSOES = "Ainda não há versões registradas para este orçamento.";
export const TEXTO_HISTORICO_INDISPONIVEL = "O histórico de versões ainda não está disponível.";
export const TEXTO_HISTORICO_FALHOU = "Não foi possível carregar o histórico de versões. Tente de novo.";
export const AUTOR_NAO_REGISTRADO = "Autor não registrado";

const num = (v: unknown, padrao = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
};
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function lerMudanca(v: unknown): MudancaDaVersao | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  return {
    mudou: m.mudou === true,
    itens_novos: num(m.itens_novos),
    itens_tirados: num(m.itens_tirados),
    itens_mudados: num(m.itens_mudados),
    campos: lista(m.campos),
    termos: lista(m.termos),
    retrato_sem_itens: m.retrato_sem_itens === true,
  };
}

/** Lê a resposta do banco. Algo que não é lista é erro (devolve null), não "sem versões". */
export function lerHistorico(bruto: unknown): VersaoDoHistorico[] | null {
  if (!Array.isArray(bruto)) return null;
  const versoes: VersaoDoHistorico[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.id !== "string") continue;
    versoes.push({
      id: v.id,
      numero: num(v.numero),
      status: typeof v.status === "string" ? v.status : "",
      criada_em: texto(v.criada_em),
      enviada_em: texto(v.enviada_em),
      aprovada_em: texto(v.aprovada_em),
      autor: texto(v.autor),
      valor_total: num(v.valor_total),
      qtd_itens: num(v.qtd_itens),
      retroativa: v.retroativa === true,
      e_a_aprovada: v.e_a_aprovada === true,
      o_que_mudou: lerMudanca(v.o_que_mudou),
      valor_anterior: v.valor_anterior == null ? null : num(v.valor_anterior),
    });
  }
  return versoes;
}

export function rotuloDaVersao(v: Pick<VersaoDoHistorico, "status" | "e_a_aprovada">): string {
  if (v.e_a_aprovada) return "Versão aprovada";
  if (v.status === "aprovada") return "Aprovada";
  if (v.status === "enviada") return "Enviada ao cliente";
  return v.status || "Versão";
}

export function autorDaVersao(v: Pick<VersaoDoHistorico, "autor">): string {
  return v.autor ?? AUTOR_NAO_REGISTRADO;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Frases do que mudou em relação à versão anterior. Versão 1 não tem anterior. */
export function frasesDoQueMudou(v: Pick<VersaoDoHistorico, "o_que_mudou" | "numero">): string[] {
  const m = v.o_que_mudou;
  if (!m) return v.numero <= 1 ? ["Primeira versão."] : [];
  if (!m.mudou) return ["Nada mudou em relação à versão anterior."];
  const f: string[] = [];
  if (m.itens_novos > 0) f.push(`${plural(m.itens_novos, "item novo", "itens novos")}.`);
  if (m.itens_tirados > 0) f.push(`${plural(m.itens_tirados, "item tirado", "itens tirados")}.`);
  if (m.itens_mudados > 0) f.push(`${plural(m.itens_mudados, "item mudado", "itens mudados")}.`);
  if (m.campos.length > 0) f.push(`Mudou: ${m.campos.join(", ")}.`);
  if (m.termos.length > 0) f.push(`Condições mudadas: ${m.termos.join(", ")}.`);
  if (m.retrato_sem_itens) f.push("Esta versão antiga não guardou a lista de itens, então a comparação dos itens não é possível.");
  return f.length > 0 ? f : ["Houve mudança em relação à versão anterior."];
}
