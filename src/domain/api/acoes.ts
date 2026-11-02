/**
 * Ações do MCP com ensaio (02/11/2026), Onda 3 do "API/MCP", no padrão do
 * Holdprint: toda ação roda em ensaio por padrão e só grava com `confirmado`.
 *
 * Nesta onda entram três ações que já existem como botão no sistema e NÃO
 * mexem em dinheiro: renovar um orçamento vencido, mover a etapa comercial de
 * um orçamento enviado e registrar uma nota na ficha do cliente. Quem executa
 * é a pessoa dona do token, com a RLS dela: o banco (`api_executar`) troca de
 * papel do mesmo jeito que a leitura. Registrar pagamento, aprovar orçamento e
 * qualquer coisa com valor ficam de fora até o dono liberar ação por ação.
 */

export type ArgumentoDaAcao = {
  nome: string;
  tipo: "uuid" | "texto" | "opcao";
  obrigatorio: boolean;
  descricao: string;
  opcoes?: readonly string[];
  maximo?: number;
};

export type AcaoDaApi = {
  chave: string;
  titulo: string;
  /** O que acontece, em uma frase que o vendedor entende. */
  efeito: string;
  /** O mesmo botão, dentro do sistema. */
  ondeFica: string;
  argumentos: readonly ArgumentoDaAcao[];
};

export const ACOES: readonly AcaoDaApi[] = [
  {
    chave: "renovar_orcamento",
    titulo: "Renovar e reenviar um orçamento",
    efeito: "Orçamento expirado, ou enviado que passou da validade, volta a Enviado com a validade contando de novo. Não manda mensagem ao cliente.",
    ondeFica: "Quadro de orçamentos, botão Renovar e reenviar",
    argumentos: [{ nome: "orcamento_id", tipo: "uuid", obrigatorio: true, descricao: "O id do orçamento (campo id em bexprint_consultar orcamentos)." }],
  },
  {
    chave: "mover_etapa_comercial",
    titulo: "Mover a etapa comercial",
    efeito: "Orçamento enviado passa a Em negociação, Aceite verbal, ou volta a só Enviado. Não muda status nem valor.",
    ondeFica: "Quadro de orçamentos, seletor de etapa no cartão",
    argumentos: [
      { nome: "orcamento_id", tipo: "uuid", obrigatorio: true, descricao: "O id do orçamento." },
      { nome: "etapa", tipo: "opcao", obrigatorio: true, descricao: "em_negociacao, aceite_verbal ou enviado (sem etapa).", opcoes: ["em_negociacao", "aceite_verbal", "enviado"] },
    ],
  },
  {
    chave: "registrar_nota_do_cliente",
    titulo: "Registrar uma nota na ficha do cliente",
    efeito: "Escreve uma nota na aba Histórico do cliente, em nome da pessoa dona do token.",
    ondeFica: "Cliente, aba Histórico, Registrar nota",
    argumentos: [
      { nome: "cliente_id", tipo: "uuid", obrigatorio: true, descricao: "O id do cliente." },
      { nome: "texto", tipo: "texto", obrigatorio: true, descricao: "A nota, até 2.000 letras.", maximo: 2000 },
    ],
  },
];

export function acaoPorChave(chave: string): AcaoDaApi | null {
  return ACOES.find((a) => a.chave === chave) ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ArgumentosLidos = { ok: true; argumentos: Record<string, string> } | { ok: false; erro: string };

/** Confere os argumentos contra a ação antes de ir ao banco: erro com frase, não silêncio. */
export function lerArgumentos(acao: AcaoDaApi, brutos: Record<string, unknown> | undefined): ArgumentosLidos {
  const saida: Record<string, string> = {};
  for (const a of acao.argumentos) {
    const v = brutos?.[a.nome];
    const texto = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    if (!texto) {
      if (a.obrigatorio) return { ok: false, erro: `Falta "${a.nome}": ${a.descricao}` };
      continue;
    }
    if (a.tipo === "uuid" && !UUID.test(texto)) return { ok: false, erro: `"${a.nome}" tem de ser um id (uuid).` };
    if (a.tipo === "opcao" && !(a.opcoes ?? []).includes(texto)) return { ok: false, erro: `"${a.nome}" tem de ser um de: ${(a.opcoes ?? []).join(", ")}.` };
    if (a.tipo === "texto" && a.maximo && texto.length > a.maximo) return { ok: false, erro: `"${a.nome}" tem de ter até ${a.maximo} letras.` };
    saida[a.nome] = texto;
  }
  const estranhos = Object.keys(brutos ?? {}).filter((k) => !acao.argumentos.some((a) => a.nome === k));
  if (estranhos.length > 0) return { ok: false, erro: `Argumento desconhecido: ${estranhos.join(", ")}. Aceitos: ${acao.argumentos.map((a) => a.nome).join(", ")}.` };
  return { ok: true, argumentos: saida };
}

/** `confirmado` só vale como verdadeiro quando vem exatamente true; qualquer outra coisa é ensaio. */
export function ehConfirmado(valor: unknown): boolean {
  return valor === true;
}
