/**
 * Meta de vendas: as contas da barra, sem React.
 *
 * Os números vêm prontos das RPCs `minha_meta()` e `meta_painel()` (a regra do
 * nível mora no banco, em tg_meta_nivel). Aqui só se decide COMO desenhar e
 * COMO falar: onde ficam os marcos, quanto da barra está cheio e a frase que
 * diz à pessoa o que fazer a seguir.
 *
 * A barra vai de zero até o diamante (150% da meta, por padrão), de modo que o
 * Ouro fica a dois terços do caminho e a pessoa vê que há um degrau além dele.
 */

export type NivelMeta = "nenhum" | "ouro" | "diamante";

export type MetaDoMes = {
  meta_id: string;
  usuario_id: string;
  usuario_nome?: string;
  mes: string;
  meta: number;
  ouro_em: number;
  diamante_em: number;
  pct_ouro: number;
  pct_diamante: number;
  diamante_em_pct: number;
  vendido: number;
  pago: number;
  os_vendidas: number;
  nivel: NivelMeta;
  pct_atual: number;
  comissao_atual: number;
  nivel_se_receber: NivelMeta;
  comissao_se_receber: number;
  proximo_nivel: "ouro" | "diamante" | null;
  falta_proximo: number;
  ritmo_por_dia_util: number | null;
  dias_uteis_restantes: number;
  dias_uteis_total: number;
  projecao_vendido: number | null;
  fechada: boolean;
  nivel_fechado: NivelMeta | null;
  pct_fechado: number | null;
  comemorado_nivel: NivelMeta;
};

export const NOME_DO_NIVEL: Record<NivelMeta, string> = {
  nenhum: "Em busca do Ouro",
  ouro: "Ouro",
  diamante: "Diamante",
};

const limitar = (v: number) => Math.min(100, Math.max(0, v));

/** Fração (0–100) da barra que um valor ocupa. A barra termina no diamante. */
export function posicaoNaBarra(valor: number, m: Pick<MetaDoMes, "diamante_em">): number {
  if (!(m.diamante_em > 0)) return 0;
  return limitar((valor / m.diamante_em) * 100);
}

export type Marco = { chave: string; rotulo: string; valor: number; posicao: number; nivel?: "ouro" | "diamante"; atingido: boolean };

/** Os marcos da barra: 50%, 75%, Ouro e Diamante. Atingido é pelo PAGO. */
export function marcos(m: MetaDoMes): Marco[] {
  const base: Array<Omit<Marco, "posicao" | "atingido">> = [
    { chave: "50", rotulo: "50%", valor: m.meta * 0.5 },
    { chave: "75", rotulo: "75%", valor: m.meta * 0.75 },
    { chave: "ouro", rotulo: "Ouro", valor: m.ouro_em, nivel: "ouro" },
    { chave: "diamante", rotulo: "Diamante", valor: m.diamante_em, nivel: "diamante" },
  ];
  return base.map((b) => ({ ...b, posicao: posicaoNaBarra(b.valor, m), atingido: m.pago >= b.valor }));
}

export type Tom = "neutro" | "ouro" | "diamante";

export type Foco = { titulo: string; detalhe: string | null; tom: Tom };

const dinheiro = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dinheiroCentavos = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/**
 * A frase que fica embaixo da barra: o que falta, ou o que a pessoa já ganhou.
 * Sempre em termos de dinheiro dela, porque é isso que prende a atenção.
 */
export function foco(m: MetaDoMes): Foco {
  if (m.nivel === "diamante") {
    return {
      titulo: "Diamante conquistado",
      detalhe: `Você ganha ${pct(m.pct_diamante)} de cada OS paga do mês — já são ${dinheiroCentavos(m.comissao_atual)}.`,
      tom: "diamante",
    };
  }
  if (m.nivel === "ouro") {
    return {
      titulo: `Ouro conquistado — faltam ${dinheiro(m.falta_proximo)} para o Diamante`,
      detalhe: `Hoje você ganha ${pct(m.pct_ouro)} (${dinheiroCentavos(m.comissao_atual)}). No Diamante o percentual sobe para ${pct(m.pct_diamante)} em todas as OS do mês.`,
      tom: "ouro",
    };
  }
  const vendidoFaltaReceber = Math.max(0, m.vendido - m.pago);
  let detalhe: string | null = null;
  if (m.nivel_se_receber !== "nenhum") {
    detalhe = `Se o que você já vendeu for pago, você fecha o ${NOME_DO_NIVEL[m.nivel_se_receber]} e ganha ${dinheiroCentavos(m.comissao_se_receber)}.`;
  } else if (vendidoFaltaReceber > 0) {
    detalhe = `${dinheiro(vendidoFaltaReceber)} já vendidos aguardam pagamento — cobrar o cliente também aproxima você do Ouro.`;
  } else if (m.ritmo_por_dia_util != null && m.dias_uteis_restantes > 0) {
    detalhe = `Para chegar lá, venda cerca de ${dinheiro(m.ritmo_por_dia_util)} por dia útil — restam ${m.dias_uteis_restantes}.`;
  }
  return { titulo: `Faltam ${dinheiro(m.falta_proximo)} para o Ouro`, detalhe, tom: "neutro" };
}

/** O nível que está sendo festejado agora (maior que o já comemorado), ou null. */
export function nivelParaComemorar(m: MetaDoMes): "ouro" | "diamante" | null {
  if (m.nivel === "diamante" && m.comemorado_nivel !== "diamante") return "diamante";
  if (m.nivel === "ouro" && m.comemorado_nivel === "nenhum") return "ouro";
  return null;
}

/** "outubro de 2026" a partir de "2026-10-01" (sem passar por Date: fuso). */
export function nomeDoMes(mes: string): string {
  const [a, n] = mes.split("-").map(Number);
  const nomes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${nomes[(n || 1) - 1]} de ${a}`;
}
