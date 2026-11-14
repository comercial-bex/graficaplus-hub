import type { SeloDaTriagem } from "../whatsapp/triagem/selo";

/**
 * O selo "Agente" do cabeçalho da conversa (C4), no mesmo molde do selo da triagem: aparece só quando existe registro REAL
 * do agente para a conversa. Ensaio nunca enviou nada ao contato e não ganha selo; conversa que o agente nunca tocou também
 * não. Texto para a equipe, nunca para o contato. Sem preço, sem a palavra do mercado que o dono não usa, sem travessão.
 *
 * Mesmo formato do selo da triagem (estado, frase, tom, explicação), para o mesmo desenho servir aos dois.
 */

export type RegistroDoAgente = {
  /**
   * Mensagens que o agente ESCOLHEU e colocou na fila desta conversa (evento `enviado`). O evento marca a FILA, não a entrega ao
   * contato: a mensagem ainda pode ser cancelada antes de sair, ou falhar no envio. Por isso o selo diz "colocou na fila" e manda
   * conferir na conversa.
   */
  respostas: number;
  /** O agente entregou a conversa à equipe, com ou sem resposta antes. */
  entregou: boolean;
};

export function seloDoAgente(r: RegistroDoAgente | null | undefined): SeloDaTriagem | null {
  if (!r) return null;
  const respostas = Number.isFinite(r.respostas) ? Math.max(0, Math.trunc(r.respostas)) : 0;
  if (respostas === 0 && !r.entregou) return null;

  if (respostas > 0 && r.entregou) {
    return {
      estado: "escolheu uma resposta, colocou na fila e entregou à equipe",
      frase: "Agente: escolheu uma resposta, colocou na fila e entregou à equipe",
      tom: "atencao",
      explicacao:
        "O agente escolheu uma resposta aprovada, colocou na fila de envio e passou a conversa para a equipe, que precisa continuar. Confira na conversa se a mensagem chegou ao contato.",
    };
  }
  if (respostas > 0) {
    return {
      estado:
        respostas === 1
          ? "escolheu uma resposta e colocou na fila"
          : `escolheu ${respostas} respostas e colocou na fila`,
      frase:
        respostas === 1
          ? "Agente: escolheu uma resposta e colocou na fila"
          : `Agente: escolheu ${respostas} respostas e colocou na fila`,
      tom: "ok",
      explicacao:
        "O agente escolheu uma resposta aprovada, escrita e aprovada pelo dono, e a colocou na fila de envio. Confira na conversa se ela chegou ao contato. Se você responder, ele para.",
    };
  }
  return {
    estado: "entregou à equipe",
    frase: "Agente: entregou à equipe",
    tom: "atencao",
    explicacao: "O agente parou e passou a conversa para a equipe, que precisa responder.",
  };
}
