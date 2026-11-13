import {
  ehOrigemDoTipo,
  ehTipoDeContato,
  rotuloDoTipo,
  textoTemPalavraDoTipo,
  type OrigemDoTipo,
  type PalavraComTipo,
  type TipoDeContato,
} from "@/domain/whatsapp/origem-do-contato";

/**
 * Só existem duas modalidades de contato: parceiro (também chamado
 * terceirizado) e cliente final. O tipo é uma etiqueta INTERNA da equipe.
 * Não decide preço: quem tem tabela de parceiro é quem está cadastrado como
 * parceiro, e o orçamento segue a cadeia de preço de sempre.
 */
export type TipoDoLead = TipoDeContato;

export { rotuloDoTipo };

/** Valor lido do banco para tipo conhecido; qualquer outra coisa (inclusive o "cliente" antigo) vira nulo. */
export function normalizarTipo(v: unknown): TipoDoLead | null {
  return ehTipoDeContato(v) ? v : null;
}

export type ResultadoDoTipo = { tipo: TipoDoLead | null; origem: OrigemDoTipo | null };

/**
 * Classificação pura. Entra tudo que já foi resolvido pelas tabelas editáveis;
 * nada de lista fixa aqui. A primeira que tiver resposta vence:
 *  0. etiqueta que a equipe marcou na mão (nunca desfeita por regra automática)
 *  1. anuncio: tipo do conjunto do anúncio (anuncioTipo)
 *  2. palavra de PARCEIRO da tabela na primeira mensagem
 *  3. telefone: cadastrado como parceiro
 *  4. palavra de CLIENTE FINAL da tabela na primeira mensagem
 *  5. sem sinal: tipo nulo ("tipo a confirmar")
 * Palavra de parceiro vence palavra de cliente final se as duas casarem.
 * Telefone não classifica cliente final.
 */
export function classificarLead({
  tipoManual,
  anuncioTipo,
  textoInicial,
  palavras = [],
  telefoneEhDeParceiro = false,
}: {
  tipoManual?: unknown;
  anuncioTipo?: unknown;
  textoInicial?: string | null;
  palavras?: readonly PalavraComTipo[];
  telefoneEhDeParceiro?: boolean;
}): ResultadoDoTipo {
  const manual = normalizarTipo(tipoManual);
  if (manual) return { tipo: manual, origem: "manual" };
  const doAnuncio = normalizarTipo(anuncioTipo);
  if (doAnuncio) return { tipo: doAnuncio, origem: "anuncio" };
  if (textoTemPalavraDoTipo(textoInicial, palavras, "parceiro")) return { tipo: "parceiro", origem: "palavra" };
  if (telefoneEhDeParceiro) return { tipo: "parceiro", origem: "telefone" };
  if (textoTemPalavraDoTipo(textoInicial, palavras, "cliente_final")) return { tipo: "cliente_final", origem: "palavra" };
  return { tipo: null, origem: null };
}

export function tipoDoLead(entrada: Parameters<typeof classificarLead>[0]): TipoDoLead | null {
  return classificarLead(entrada).tipo;
}

/** As telas usam apenas o tipo persistido; ausência nunca infere parceiro. */
export function ehLeadParceiro(tipo: unknown): boolean {
  return normalizarTipo(tipo) === "parceiro";
}

export function origemDoTipoValida(v: unknown): OrigemDoTipo | null {
  return ehOrigemDoTipo(v) ? v : null;
}

export function filtrarParceiros<T extends { tipo?: unknown }>(leads: T[], somente: boolean): T[] {
  return somente ? leads.filter((l) => ehLeadParceiro(l.tipo)) : leads;
}

/** Fica enquanto a migração da coluna leads.tipo não estiver aplicada em todo ambiente. */
export function colunaTipoAusente(erro: { code?: string; message?: string } | null): boolean {
  return !!erro && ["42703", "PGRST204"].includes(erro.code ?? "") &&
    /\btipo\b/i.test(erro.message ?? "");
}
