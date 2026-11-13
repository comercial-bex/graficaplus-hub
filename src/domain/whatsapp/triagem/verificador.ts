import { semAcento } from "./normalizar";
import type { Ramo } from "./tipos";

/**
 * Verificador de texto proibido: a última porta antes de qualquer mensagem sair.
 *
 * Regra do dono: cliente final nunca lê a palavra parceiro, revendedor, tabela
 * nem preço diferenciado, e a triagem nunca fala valor, desconto, prazo ou forma
 * de pagamento. Esta função é a fonte única da regra no código; o banco tem a
 * mesma lista em `whatsapp_triagem_termos_proibidos` (B1) e o servidor roda esta
 * função no texto JÁ MONTADO, com o nome do contato e o endereço dentro, antes
 * de enfileirar. Se reprovar, não envia.
 */

export type ProblemaDeTexto = { regra: string; trecho: string };

type Regra = { regra: string; teste: RegExp; ramos: "todos" | "cliente" };

/** Termos de dinheiro e prazo: valem para os dois ramos. */
const REGRAS: readonly Regra[] = [
  { regra: "moeda", teste: /r\s?\$/i, ramos: "todos" },
  { regra: "valor_em_reais", teste: /\b\d[\d.,]*\s*(reais|real|mil)\b|\breais\b/i, ramos: "todos" },
  {
    regra: "valor_com_centavos",
    teste: /\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d+[.,]\d{2}\b(?!\s*(?:h|horas?))/i,
    ramos: "todos",
  },
  { regra: "valor_depois_de_valor", teste: /\bvalor(?:es)?\s*(?:de|e|:)?\s*\d/i, ramos: "todos" },
  { regra: "porcentagem", teste: /%|\bpor\s?cento\b/i, ramos: "todos" },
  { regra: "desconto", teste: /desconto/i, ramos: "todos" },
  { regra: "pix", teste: /\bpix\b/i, ramos: "todos" },
  { regra: "boleto", teste: /\bboleto/i, ramos: "todos" },
  { regra: "parcelamento", teste: /\bparcel/i, ramos: "todos" },
  { regra: "juros", teste: /\bjuros\b/i, ramos: "todos" },
  { regra: "nota_fiscal", teste: /nota\s+fiscal/i, ramos: "todos" },
  {
    regra: "prazo_em_numero",
    teste: /\b\d+\s*(dias?|horas?|semanas?|meses|uteis)\b/i,
    ramos: "todos",
  },
  // só no ramo cliente final
  { regra: "parceiro", teste: /parceir|parceri/i, ramos: "cliente" },
  { regra: "terceirizado", teste: /terceiriz/i, ramos: "cliente" },
  { regra: "revendedor", teste: /revend/i, ramos: "cliente" },
  { regra: "tabela", teste: /tabela/i, ramos: "cliente" },
  {
    regra: "preco_diferenciado",
    teste:
      /diferenciad|(?:preco|valor|condicoes?)\s+(?:especial|especiais|de custo|de atacado)|\batacado\b/i,
    ramos: "cliente",
  },
];

/** Estilo pedido pelo dono: sem travessão, seta nem parênteses; nada de variável sem preencher. */
const ESTILO: readonly Regra[] = [
  { regra: "travessao", teste: /[—–]/, ramos: "todos" },
  { regra: "seta", teste: /[←-⇿➔➡]|->|=>|<-/, ramos: "todos" },
  { regra: "parenteses", teste: /[()]/, ramos: "todos" },
  { regra: "variavel_sem_preencher", teste: /\{\{|\}\}/, ramos: "todos" },
];

export type ResultadoDaVerificacao = { ok: boolean; problemas: ProblemaDeTexto[] };

export function verificarTexto(texto: string, ramo: Ramo): ResultadoDaVerificacao {
  const bruto = texto ?? "";
  const plano = semAcento(bruto).toLowerCase();
  const problemas: ProblemaDeTexto[] = [];
  for (const r of [...REGRAS, ...ESTILO]) {
    if (r.ramos === "cliente" && ramo !== "cliente") continue;
    const alvo =
      r.regra === "moeda" || r.regra === "porcentagem" || ESTILO.includes(r) ? bruto : plano;
    const m = alvo.match(r.teste);
    if (m) problemas.push({ regra: r.regra, trecho: m[0] });
  }
  if (!bruto.trim()) problemas.push({ regra: "vazio", trecho: "" });
  if (bruto.length > 600) problemas.push({ regra: "acima_de_600_caracteres", trecho: "" });
  return { ok: problemas.length === 0, problemas };
}

export function textoLimpo(texto: string, ramo: Ramo): boolean {
  return verificarTexto(texto, ramo).ok;
}
