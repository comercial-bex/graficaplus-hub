import { verificarTexto } from "./verificador";
import type { PassoDeTexto, Ramo } from "./tipos";

/**
 * Textos da triagem: o texto sai do banco (`whatsapp_triagem_passos`), a lógica
 * sai do código. Aqui ficam só as funções puras de montar texto, escolher a
 * variante e validar o que o dono edita.
 */

export const VARIAVEIS_PERMITIDAS = [
  "primeiro_nome",
  "nome_completo",
  "telefone",
  "cep",
  "bairro",
  "cidade",
  "abre",
  "fecha",
  "dias",
  "link_parceiro",
  "ack",
] as const;
/** Cliente final nunca recebe o link de parceiro, por nenhum texto. */
export const VARIAVEIS_DO_RAMO_CLIENTE = VARIAVEIS_PERMITIDAS.filter((v) => v !== "link_parceiro");

export function variaveisDoTexto(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))];
}

export type TextoPreenchido = { texto: string; faltando: string[] };

/** Preenche `{{variavel}}`. `ack` pode ficar vazia; qualquer outra vazia entra em `faltando`. */
export function preencher(
  template: string,
  valores: Readonly<Record<string, string | null | undefined>>,
): TextoPreenchido {
  const faltando: string[] = [];
  const texto = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, nome: string) => {
    const v = valores[nome];
    if ((v === undefined || v === null || v === "") && nome !== "ack") faltando.push(nome);
    return v ?? "";
  });
  return {
    texto: texto
      .replace(/[ \t]+/g, " ")
      .replace(/ +([,.!?])/g, "$1")
      .replace(/\n[ \t]+/g, "\n")
      .trim(),
    faltando,
  };
}

/** Valores de exemplo, para validar o texto na hora em que o dono salva. */
export const VALORES_DE_EXEMPLO: Readonly<Record<string, string>> = {
  primeiro_nome: "Maria",
  nome_completo: "Maria Souza",
  telefone: "terminado em 2233",
  cep: "68900-000",
  bairro: "Centro",
  cidade: "Macapá",
  abre: "8h",
  fecha: "18h",
  dias: "de segunda a sexta",
  link_parceiro: "https://exemplo.com.br/convite",
  ack: "Tudo bem, sem problema.",
};

export type ProblemaDeEdicao = { regra: string; detalhe: string };

/**
 * A validação de quando o dono salva (o gatilho do banco faz a mesma coisa):
 * não vazio, até 600 caracteres, variável só da lista, e nada de termo proibido
 * do ramo, avaliado com valores de exemplo preenchidos.
 */
export function validarTextoEditavel(texto: string, ramo: Ramo): ProblemaDeEdicao[] {
  const problemas: ProblemaDeEdicao[] = [];
  const t = texto ?? "";
  if (!t.trim()) return [{ regra: "vazio", detalhe: "" }];
  if (t.length > 600)
    problemas.push({ regra: "acima_de_600_caracteres", detalhe: String(t.length) });
  const permitidas: readonly string[] =
    ramo === "cliente" ? VARIAVEIS_DO_RAMO_CLIENTE : VARIAVEIS_PERMITIDAS;
  for (const v of variaveisDoTexto(t)) {
    if (!permitidas.includes(v)) problemas.push({ regra: "variavel_nao_permitida", detalhe: v });
  }
  const { texto: montado } = preencher(t, VALORES_DE_EXEMPLO);
  for (const p of verificarTexto(montado, ramo).problemas)
    problemas.push({ regra: p.regra, detalhe: p.trecho });
  return problemas;
}

/* ------------------------------------------------------------------ */
/* Escolha de variante e atraso, estáveis por conversa                 */
/* ------------------------------------------------------------------ */

/**
 * Número estável do identificador da conversa: os 8 últimos dígitos hexadecimais
 * do uuid. Dá para repetir no banco com
 * `('x' || right(replace(id::text, '-', ''), 8))::bit(32)::bigint`.
 */
export function numeroDoIdentificador(id: string): number {
  const hex = (id ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length >= 8) return parseInt(hex.slice(-8), 16);
  let h = 2166136261;
  for (const c of id ?? "") h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** O mesmo contato sempre recebe a mesma variante; o envio repetido não muda. */
export function escolherVariante(
  passo: Pick<PassoDeTexto, "texto" | "variantes">,
  conversaId: string,
): string {
  const todas = [passo.texto, ...(passo.variantes ?? []).filter((v) => v && v.trim())];
  return todas[numeroDoIdentificador(conversaId) % todas.length];
}

/** Sorteio estável do modo parcial: resto da divisão por 100. */
export function entraNoSorteio(conversaId: string, percentual: number): boolean {
  return numeroDoIdentificador(conversaId) % 100 < percentual;
}

/** Segundos de "digitando", valor fixo por conversa e passo, dentro de 1 a 15 s (limite do Z-API). */
export function atrasoHumanizado(
  conversaId: string,
  passo: string,
  minS: number,
  maxS: number,
): number {
  const min = Math.min(15, Math.max(1, Math.round(minS)));
  const max = Math.min(15, Math.max(min, Math.round(maxS)));
  let h = 0;
  for (const c of passo) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return min + ((numeroDoIdentificador(conversaId) + h) % (max - min + 1));
}
