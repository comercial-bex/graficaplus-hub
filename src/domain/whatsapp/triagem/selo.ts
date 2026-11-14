/**
 * O selo "Triagem automática" da caixa de WhatsApp (B9): que estado da triagem
 * aparece, com que texto e com que tom. Função pura, sem banco nem tela.
 *
 * Aparece só quando existe um registro de triagem REAL para a conversa. Simulação
 * (modo ensaio) nunca enviou nada ao contato e não ganha selo; conversa que o
 * portão deixou de fora (pulada) também não, porque a triagem nem começou.
 * Texto para a equipe, nunca para o contato. Sem preço, sem a palavra proibida
 * do dono e sem travessão.
 */

export type TomDoSelo = "neutro" | "ok" | "atencao";

export type SeloDaTriagem = {
  /** Só o estado, em minúsculas, para a lista: "em andamento". */
  estado: string;
  /** Frase completa para cabeçalho e leitor de tela: "Triagem automática: em andamento". */
  frase: string;
  tom: TomDoSelo;
  /** O que isso quer dizer, em uma frase, para quem passar o mouse ou tocar. */
  explicacao: string;
};

const ESTADOS: Record<string, { estado: string; tom: TomDoSelo; explicacao: string }> = {
  ativa: {
    estado: "em andamento",
    tom: "neutro",
    explicacao: "O robô de boas-vindas está pedindo os dados do contato. Se você responder, ele pausa.",
  },
  concluida: {
    estado: "concluída",
    tom: "ok",
    explicacao: "O robô terminou de pedir os dados. Falta a equipe continuar o atendimento.",
  },
  entregue_equipe: {
    estado: "entregue à equipe",
    tom: "atencao",
    explicacao: "O robô parou e passou a conversa para a equipe, que precisa responder.",
  },
  pausada_humano: {
    estado: "pausada pela equipe",
    tom: "atencao",
    explicacao: "Alguém da equipe respondeu ou assumiu a conversa, então o robô parou.",
  },
  expirada: {
    estado: "sem resposta",
    tom: "neutro",
    explicacao: "O robô perguntou e o contato não voltou dentro do prazo.",
  },
  pausada_desligada: {
    estado: "pausada, robô desligado",
    tom: "neutro",
    explicacao: "O robô foi desligado ou saiu do degrau de liberação no meio desta conversa.",
  },
  parada_pelo_contato: {
    estado: "contato pediu para parar",
    tom: "neutro",
    explicacao: "O contato pediu para não receber mais as mensagens automáticas.",
  },
};

export function seloDaTriagem(
  status: string | null | undefined,
  modo?: string | null,
): SeloDaTriagem | null {
  if (!status || modo === "ensaio") return null;
  const e = ESTADOS[status];
  if (!e) return null;
  return {
    estado: e.estado,
    frase: `Triagem automática: ${e.estado}`,
    tom: e.tom,
    explicacao: e.explicacao,
  };
}
