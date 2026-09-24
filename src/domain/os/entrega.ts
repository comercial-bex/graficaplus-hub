/**
 * O status da entrega ou instalação — fonte única.
 *
 * Existe porque havia DUAS palavras para o mesmo fato e elas nunca se
 * encontraram:
 *
 *   a tela /entregas gravava   'concluido'   (masculino)
 *   `fechar_os` procurava      'concluida'   (feminino)
 *
 * `fechar_os` bloqueia o fechamento enquanto houver entrega cujo status não
 * esteja em ('concluida','cancelada','nao_necessaria'). Dar baixa na entrega
 * pela tela gravava 'concluido' — que não está na lista — e a OS ficava presa
 * em "em entrega" PARA SEMPRE: fora do realizado do mês, fora do faturado,
 * fora do portal do cliente, sem erro nenhum na tela.
 *
 * A coluna é `text` e não tinha CHECK, então nada impedia uma terceira
 * grafia. Agora tem CHECK no banco, esta lista no front e um teste que confere
 * que as duas batem.
 *
 * `nao_necessaria` existe para o caso em que a peça sai pelo balcão depois de
 * a entrega já ter sido aberta: sem ela, a única saída seria "cancelada", que
 * diz outra coisa.
 */

export const STATUS_ENTREGA = [
  "agendada",
  "em_rota",
  "concluida",
  "cancelada",
  "nao_necessaria",
] as const;

export type StatusEntrega = (typeof STATUS_ENTREGA)[number];

/** Status em que a entrega não trava mais o fechamento da OS. */
export const STATUS_ENTREGA_ENCERRADOS: StatusEntrega[] = [
  "concluida",
  "cancelada",
  "nao_necessaria",
];

export const ROTULO_ENTREGA: Record<StatusEntrega, string> = {
  agendada: "Agendada",
  em_rota: "Em rota",
  concluida: "Concluída",
  cancelada: "Cancelada",
  nao_necessaria: "Não foi preciso",
};

/** O que cada status significa para quem está na tela decidindo. */
export const EXPLICACAO_ENTREGA: Record<StatusEntrega, string> = {
  agendada: "Marcada, ainda não saiu.",
  em_rota: "Saiu para o cliente.",
  concluida: "Entregue. Ao dar esta baixa, a OS fecha sozinha se nada mais estiver pendente.",
  cancelada: "Não vai acontecer. Deixa de travar o fechamento da OS.",
  nao_necessaria: "O cliente retirou no balcão, ou a entrega deixou de fazer sentido.",
};

export function entregaEstaEncerrada(status: string | null | undefined): boolean {
  return !!status && (STATUS_ENTREGA_ENCERRADOS as string[]).includes(status);
}

export function rotuloEntrega(status: string | null | undefined): string {
  if (!status) return "—";
  return ROTULO_ENTREGA[status as StatusEntrega] ?? status;
}
