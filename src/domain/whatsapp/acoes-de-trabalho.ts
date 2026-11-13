/**
 * O que dá para fazer com a conversa além de responder: criar orçamento,
 * criar OS e vincular a um cliente. Dono: GAVETA (onda 1, 12/11/2026).
 *
 * Os três diálogos moram na gaveta (`dialogos-da-conversa.tsx`) e abrem de três
 * lugares: o cabeçalho da conversa (botão Orçamento e menu de três pontos), o
 * [+] da caixa de resposta e a própria gaveta. Quem desenha o botão consulta
 * esta função para saber se mostra o item ou diz por que não dá; a regra é a
 * mesma que o painel da conversa aplicava (painel-da-conversa.tsx, 21/10/2026).
 */

/** Os diálogos de trabalho da conversa. */
export type DialogoDaConversa = "orcamento" | "os" | "vincular_cliente";

export type Disponivel = { pode: true } | { pode: false; motivo: string };

export type QuemPede = {
  /** whatsapp.reply */
  podeResponder: boolean;
  /** orcamentos.create */
  podeOrcar: boolean;
  /** os.create */
  podeAbrirOs: boolean;
  /** A conversa já está ligada a um cliente cadastrado. */
  clienteId: string | null;
};

/**
 * Cada diálogo, liberado ou com o motivo à vista. O motivo é a frase que a
 * tela mostra no lugar do botão: escondida, a ação parece não existir.
 */
export function oQueDaPraFazer(q: QuemPede): Record<DialogoDaConversa, Disponivel> {
  const orcamento: Disponivel = q.podeOrcar
    ? { pode: true }
    : { pode: false, motivo: "Criar orçamento exige a permissão orçamentos › create." };
  const os: Disponivel = !q.podeAbrirOs
    ? {
        pode: false,
        motivo:
          "Abrir OS direto é do administrador. Crie o orçamento: aprovado, ele vira OS pelo gerente.",
      }
    : !q.clienteId
      ? {
          pode: false,
          motivo:
            "A OS exige cliente cadastrado. Vincule a conversa a um cliente ou comece pelo orçamento.",
        }
      : { pode: true };
  const vincular_cliente: Disponivel = q.podeResponder
    ? { pode: true }
    : {
        pode: false,
        motivo: "Vincular a conversa a um cliente exige a permissão whatsapp › reply.",
      };
  return { orcamento, os, vincular_cliente };
}
