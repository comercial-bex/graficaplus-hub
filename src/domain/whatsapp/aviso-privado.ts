import { numeroParaMencao, type PessoaDaEquipe } from "./cobranca";
import { telefoneParaZapi } from "./zapi-envio";

/**
 * Aviso no WhatsApp PRIVADO do gerente (15/11/2026).
 *
 * É um evento à parte do `aviso_grupo_equipe`: a trava do grupo continua intacta e esta regra
 * só abre uma porta estreita, a de gestor ou admin ATIVO com celular cadastrado. Cliente,
 * parceiro, vendedor e qualquer outro número caem como falha definitiva, sem chamar o Z-API.
 */
export const EVENTO_AVISO_GERENTE_PRIVADO = "aviso_gerente_privado";

const PAPEIS_QUE_RECEBEM = new Set(["gestor", "admin"]);

/** A linha da fila é deste evento, pelo `evento` ou pelo `template`? */
export function ehAvisoPrivadoDoGerente(linha: { evento?: string | null; template?: string | null }): boolean {
  return linha.evento === EVENTO_AVISO_GERENTE_PRIVADO || linha.template === EVENTO_AVISO_GERENTE_PRIVADO;
}

/** Os celulares (55 + DDD + número) de quem tem papel de gestor ou admin. `equipe` só traz gente ativa. */
export function numerosDaGerencia(equipe: readonly PessoaDaEquipe[]): Set<string> {
  const numeros = new Set<string>();
  for (const pessoa of equipe) {
    if (!pessoa.papeis?.some((p) => PAPEIS_QUE_RECEBEM.has(p))) continue;
    const numero = numeroParaMencao(pessoa.telefone);
    if (numero) numeros.add(numero);
  }
  return numeros;
}

export type DecisaoDoAvisoPrivado = { ok: true; para: string } | { ok: false; erro: string };

/**
 * Pode sair? Só se o destino é o celular de um gestor ou admin. Devolve o número já no formato
 * do Z-API (com o 55): a fila grava sem ele (`normalize_whatsapp_phone` tira), o Z-API exige.
 * Evento e modelo têm de ser os dois deste aviso: um evento de outro assunto com este modelo
 * (ou o contrário) não passa.
 */
export function decidirAvisoPrivado(
  linha: { evento?: string | null; template?: string | null; destinatario?: string | null },
  gerencia: ReadonlySet<string>,
): DecisaoDoAvisoPrivado {
  const evento = linha.evento ?? null;
  const template = linha.template ?? null;
  if (
    (evento !== null && evento !== EVENTO_AVISO_GERENTE_PRIVADO) ||
    (template !== null && template !== EVENTO_AVISO_GERENTE_PRIVADO)
  ) {
    return { ok: false, erro: "o aviso privado do gerente não usa o modelo de outro aviso" };
  }
  const para = telefoneParaZapi(linha.destinatario);
  if (!para || !/^55\d{11}$/.test(para) || !gerencia.has(para)) {
    return { ok: false, erro: "o aviso privado só vai para o celular de um gestor ou admin" };
  }
  return { ok: true, para };
}
