import { ehGrupoZapi } from "@/domain/whatsapp/zapi-envio";

/**
 * Número que o dono mandou parar (tabela `whatsapp_numeros_bloqueados`, 17/11/2026).
 *
 * A CHAVE é a mesma que o banco guarda (função `_wa_chave_numero`): só os dígitos; se sobram 12 ou mais e começa com
 * 55, tira o código do país; fica o DDD (2 primeiros) mais os 8 últimos dígitos. Assim "(96) 99142-3082",
 * "5596991423082" e "559691423082@s.whatsapp.net" dão a mesma chave, "9691423082", com ou sem o nono dígito.
 * Menos de 10 dígitos não tem chave: nunca bloqueia e nunca casa. Grupo também não: o id do grupo não é número de
 * pessoa, e o aviso à equipe vai para ele.
 *
 * POR QUE ESTE ARQUIVO EXISTE. O bloqueio nasceu só no banco: gatilhos BEFORE INSERT em `notificacoes_fila` e em
 * `whatsapp_fila_envio`. A terceira fila, `automacao_execucoes`, manda direto para o telefone do `payload` e não
 * passava por nenhum gatilho: a automação "Lembrete à operação" continuou mandando "Olá, Leonardo!" todo dia às 09:00
 * depois do bloqueio (18, 19, 20 e 21/11, medido em whatsapp_logs). O envio é a última porta: toda linha, de qualquer
 * fila, é conferida aqui antes de chamar o Z-API.
 */
export const MOTIVO_NUMERO_BLOQUEADO = "Número bloqueado pelo dono: nenhuma mensagem é enviada.";

/** A mesma chave de `_wa_chave_numero`; null quando não há número de pessoa a comparar. */
export function chaveDoNumeroBloqueado(telefone: string | null | undefined): string | null {
  if (ehGrupoZapi(telefone)) return null;
  const d = String(telefone ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const semPais = d.length >= 12 && d.startsWith("55") ? d.slice(2) : d;
  return semPais.slice(0, 2) + d.slice(-8);
}

/** O destino está na lista dos bloqueados? Destino sem número de pessoa (grupo, vazio) nunca está. */
export function numeroBloqueado(
  chaves: ReadonlySet<string>,
  telefone: string | null | undefined,
): boolean {
  const chave = chaveDoNumeroBloqueado(telefone);
  return chave !== null && chaves.has(chave);
}
