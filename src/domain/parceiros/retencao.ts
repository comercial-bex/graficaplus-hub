/**
 * Quem está esfriando na rede de parceiros — para a equipe ligar antes de perder.
 *
 * Parceiro revendedor não avisa quando vai embora: ele só para de comprar. O
 * sinal vem de duas coisas que o sistema já sabe sem ver a carteira dele
 * (que é dele e a gráfica não enxerga): há quanto tempo não compra e se ainda
 * faz orçamento pelo painel. Orçamento feito sem pedido é negócio na mão — a
 * conversa certa é "precisa de ajuda para fechar?", não "sumiu?".
 *
 * Os cortes (30 e 60 dias) são o ponto de partida comum em programas de
 * revenda; mudá-los aqui muda a lista inteira.
 */

export type ResumoParaRetencao = {
  status: string;
  criado_em: string;
  ultima_compra: string | null;
  dias_sem_comprar: number | null;
  ultimo_acesso_em: string | null;
  orcamentos_30d: number;
};

export type SinalDeRetencao = {
  chave: "ativo" | "comecando" | "esfriando" | "parado" | "sem_compra" | "inativo";
  rotulo: string;
  detalhe: string;
  tom: "lime" | "cyan" | "amber" | "magenta" | "muted";
  /** maior = mais urgente, para ordenar a lista de quem ligar primeiro */
  urgencia: number;
};

export const DIAS_ESFRIANDO = 30;
export const DIAS_PARADO = 60;
const DIAS_COMECANDO = 30;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function sinalDeRetencao(p: ResumoParaRetencao, agora = new Date()): SinalDeRetencao {
  if (p.status !== "ativo") {
    return {
      chave: "inativo",
      rotulo: p.status === "suspenso" ? "Suspenso" : "Encerrado",
      detalhe: "Sem acesso ao painel.",
      tom: "muted",
      urgencia: 0,
    };
  }

  const nuncaEntrou = !p.ultimo_acesso_em;
  const orcou = Number(p.orcamentos_30d) || 0;
  const complemento = [
    orcou > 0 ? `fez ${plural(orcou, "orçamento", "orçamentos")} no mês` : null,
    nuncaEntrou ? "ainda não abriu o painel" : null,
  ]
    .filter(Boolean)
    .join(" e ");

  if (!p.ultima_compra || p.dias_sem_comprar === null) {
    const dias = Math.max(
      0,
      Math.floor((agora.getTime() - new Date(p.criado_em).getTime()) / 86_400_000),
    );
    if (dias <= DIAS_COMECANDO) {
      return {
        chave: "comecando",
        rotulo: "Começando",
        detalhe: `Entrou há ${plural(dias, "dia", "dias")}${complemento ? ` · ${complemento}` : ""}. Acompanhe o primeiro pedido.`,
        tom: "cyan",
        urgencia: 2,
      };
    }
    return {
      chave: "sem_compra",
      rotulo: "Nunca comprou",
      detalhe: `Cadastrado há ${plural(dias, "dia", "dias")} e sem pedido${complemento ? ` · ${complemento}` : ""}.`,
      tom: "magenta",
      urgencia: 4,
    };
  }

  const d = p.dias_sem_comprar;
  if (d <= DIAS_ESFRIANDO) {
    return {
      chave: "ativo",
      rotulo: "Comprando",
      detalhe: `Última compra há ${plural(d, "dia", "dias")}${complemento ? ` · ${complemento}` : ""}.`,
      tom: "lime",
      urgencia: 1,
    };
  }
  if (d <= DIAS_PARADO) {
    return {
      chave: "esfriando",
      rotulo: "Esfriando",
      detalhe:
        orcou > 0
          ? `Sem comprar há ${d} dias, mas ${complemento}: tem negócio na mão.`
          : `Sem comprar há ${d} dias${complemento ? ` · ${complemento}` : ""}.`,
      tom: "amber",
      urgencia: 3,
    };
  }
  return {
    chave: "parado",
    rotulo: "Parado",
    detalhe: `Sem comprar há ${d} dias${complemento ? ` · ${complemento}` : ""}. Vale uma ligação.`,
    tom: "magenta",
    urgencia: 5,
  };
}
