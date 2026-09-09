/**
 * Prazo — leitura de data sem hora.
 *
 * `ordens_servico.prazo_entrega` é coluna DATE: chega do PostgREST como
 * "2026-09-09", sem hora e sem fuso. E `new Date("2026-09-09")` NÃO devolve 9 de
 * setembro no Brasil — a norma manda ler o formato só-data como UTC, e UTC-3
 * joga o instante para 8 de setembro às 21h.
 *
 * Duas consequências, as duas visíveis na tela:
 *
 *   toLocaleDateString → mostrava 08/09 numa OS cujo prazo é 09/09
 *   comparação com hoje → OS que vence HOJE aparecia como ATRASADA
 *
 * Conferido no banco em 09/09/2026: a OS #49 tem prazo_entrega = 2026-09-09 e
 * `prazo_entrega < current_date` é FALSE no Postgres — enquanto o Kanban a
 * pintava de vermelho com o selo "Atrasada" e a data 08/09. O quadro mentia
 * sobre um compromisso com o cliente, um dia inteiro adiantado.
 *
 * A regra: data sem hora é dia do calendário, e dia do calendário se lê no fuso
 * de quem olha. Já `timestamptz` (prazo_cliente, prazo_interno) tem instante
 * próprio e passa direto.
 */

const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lê o valor no fuso local quando ele é só-data; caso contrário, deixa o parse
 * normal do Date agir (timestamp já traz o fuso embutido).
 */
export function dataLocal(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  if (SO_DATA.test(valor)) {
    const [ano, mes, dia] = valor.split("-").map(Number);
    return new Date(ano, mes - 1, dia);
  }
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Meia-noite local do dia de `agora` — a fronteira do "hoje". */
function inicioDoDia(agora: Date): Date {
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

/**
 * Atrasado é o que venceu ANTES de hoje. O que vence hoje ainda dá tempo — é
 * "vence hoje", e merece aviso diferente de "atrasada".
 */
export function atrasado(prazo: string | null | undefined, agora = new Date()): boolean {
  const d = dataLocal(prazo);
  if (!d) return false;
  return d.getTime() < inicioDoDia(agora).getTime();
}

/** Dias inteiros até o prazo: 0 = vence hoje, negativo = atrasado. */
export function diasAte(prazo: string | null | undefined, agora = new Date()): number | null {
  const d = dataLocal(prazo);
  if (!d) return null;
  const umDia = 86_400_000;
  return Math.round((inicioDoDia(d).getTime() - inicioDoDia(agora).getTime()) / umDia);
}

/**
 * O prazo em uma frase curta, para caber no cartão. Contar os dias evita a
 * conta de cabeça que o operador faria olhando só a data — e é o que separa
 * "entrega quarta" de "entrega quarta E ATRASOU".
 */
export function prazoEmPalavras(
  prazo: string | null | undefined,
  agora = new Date(),
): { texto: string; tom: "magenta" | "amber" | "muted" } | null {
  const dias = diasAte(prazo, agora);
  if (dias === null) return null;
  if (dias < -1) return { texto: `${-dias} dias de atraso`, tom: "magenta" };
  if (dias === -1) return { texto: "1 dia de atraso", tom: "magenta" };
  if (dias === 0) return { texto: "vence hoje", tom: "amber" };
  if (dias === 1) return { texto: "vence amanhã", tom: "amber" };
  if (dias <= 3) return { texto: `faltam ${dias} dias`, tom: "amber" };
  return { texto: `faltam ${dias} dias`, tom: "muted" };
}

/** dd/mm — o formato do cartão. */
export function formatarDiaMes(prazo: string | null | undefined): string {
  const d = dataLocal(prazo);
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** dd/mm/aaaa — o formato da ficha e dos documentos. */
export function formatarData(prazo: string | null | undefined): string {
  const d = dataLocal(prazo);
  return d ? d.toLocaleDateString("pt-BR") : "—";
}

/**
 * Há quanto tempo o cartão está parado, em palavras. Recebe timestamp (com
 * fuso), não data.
 *
 * Serve para responder no quadro a pergunta que o Kanban existe para responder:
 * o que está encalhado. "Última mov.: 07/09, 00:03" obriga a fazer a conta;
 * "parada há 2 dias" já é a conta feita.
 */
export function paradaHa(desde: string | null | undefined, agora = new Date()): string | null {
  const d = dataLocal(desde);
  if (!d) return null;
  const minutos = Math.floor((agora.getTime() - d.getTime()) / 60_000);
  if (minutos < 0) return null;
  if (minutos < 60) return "agora";
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas}h`;
  const dias = Math.floor(horas / 24);
  return `${dias}d`;
}
