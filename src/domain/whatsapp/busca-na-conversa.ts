import { textoSemAcento } from "@/domain/whatsapp/linha-do-tempo";

/**
 * A busca dentro da conversa aberta (lupa do cabeçalho). Dono: CONVERSA (onda 1,
 * 12/11/2026). Acha as mensagens cujo texto tem o termo (sem diferenciar acento
 * nem maiúscula, como o realce `partesComRealce` que marca o trecho) e anda
 * entre elas em círculo: depois da última volta para a primeira.
 */

/** Os ids das mensagens que casam, na ordem em que aparecem na conversa. */
export function ocorrenciasDaBusca(
  mensagens: readonly { id: string; texto: string }[],
  termo: string,
): string[] {
  const busca = textoSemAcento(termo.trim());
  if (!busca) return [];
  return mensagens.filter((m) => textoSemAcento(m.texto).includes(busca)).map((m) => m.id);
}

/**
 * O próximo índice da busca. `sentido` 1 desce na conversa (mais novas), -1
 * sobe. Sem ocorrência devolve -1; sem posição atual (-1), 1 vai para a
 * primeira e -1 para a última.
 */
export function andarNaBusca(atual: number, total: number, sentido: 1 | -1): number {
  if (total <= 0) return -1;
  if (atual < 0 || atual >= total) return sentido === 1 ? 0 : total - 1;
  return (atual + sentido + total) % total;
}

/** "2 de 5" (ou "Nada encontrado"), o contador que a barra de busca mostra. */
export function resumoDaBusca(atual: number, total: number, termo: string): string {
  if (!termo.trim()) return "";
  if (total === 0) return "Nada encontrado";
  return `${Math.min(atual, total - 1) + 1} de ${total}`;
}
