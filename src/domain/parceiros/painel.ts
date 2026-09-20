/**
 * O painel do parceiro revendedor: o que a tela diz sobre nível, metas, crédito
 * e pedidos.
 *
 * O parceiro não é funcionário e não conhece o sistema da gráfica. Tudo aqui
 * vira frase dele: "faltam R$ 300 para Prata", não "compras_90d 1200 /
 * compra_minima 1500"; "em produção", não "em_impressao".
 *
 * Metas são de prêmio CERTO — todo parceiro que bate, ganha. Não existe aqui (nem
 * no banco) quantidade limitada de prêmios nem sorteio: isso é promoção comercial
 * que exige autorização prévia da Secretaria de Prêmios e Apostas (SPA/MF).
 */

import { dataLocal, diasAte } from "@/domain/os/prazo";
import { etapaDe } from "@/domain/os/etapas";
import { brl } from "./preco";

export type NivelAtual = {
  id: string | null;
  nome: string | null;
  ordem: number;
  cor: string | null;
  desconto_pct: number;
  desconto_faixa_pct: number;
  cashback_pct: number;
  beneficios: string[];
  /** a gestão fixou este nível como piso */
  fixado: boolean;
  compras_90d: number;
  proximo: { nome: string; compra_minima_90d: number; falta: number; desconto_pct: number } | null;
};

export type NivelDaRegua = {
  id: string;
  nome: string;
  ordem: number;
  compra_minima_90d: number;
  desconto_pct: number;
  cashback_pct: number;
  cor: string;
  beneficios: string[];
};

export type MetricaDaMeta = "valor_compras" | "metragem_compras" | "quantidade_pedidos";

export type Campanha = {
  id: string;
  titulo: string;
  descricao: string | null;
  metrica: MetricaDaMeta;
  meta: number;
  inicio: string;
  fim: string;
  recompensa_tipo: "credito" | "produto" | "brinde";
  recompensa_valor: number | null;
  recompensa_descricao: string;
  atual: number;
  conquistada: boolean;
};

export type Conquista = {
  id: string;
  campanha: string;
  recompensa: string;
  recompensa_tipo: Campanha["recompensa_tipo"];
  status: "a_entregar" | "entregue";
  alcancado_em: string;
  entregue_em: string | null;
};

export type Oferta = {
  id: string;
  titulo: string;
  mensagem: string;
  produto_id: string | null;
  produto_nome: string | null;
  produto_unidade: string | null;
  preco_oferta: number | null;
  fim: string;
  exibir_popup: boolean;
  vista: boolean;
};

export type PedidoDoParceiro = {
  orcamento_parceiro_id: string;
  orcamento_parceiro_numero: number;
  titulo: string;
  pedido_numero: number;
  pedido_status: string;
  valor: number;
  os_numero: number | null;
  os_status: string | null;
  enviado_em: string;
};

export type TipoDeCredito = "cashback" | "recompensa" | "uso" | "estorno_uso" | "ajuste";

export type LancamentoDeCredito = {
  tipo: TipoDeCredito;
  valor: number;
  descricao: string;
  created_at: string;
};

export type MarcaDoParceiro = {
  nome: string | null;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  cidade: string | null;
  estado: string | null;
  cor: string;
  logo_path: string | null;
  rodape: string | null;
};

export type PainelDoParceiro = {
  parceiro: {
    id: string;
    nome: string;
    desde: string;
    tem_atendente: boolean;
    /** Código do link que ele manda para outro revendedor. */
    codigo_convite: string | null;
    /** Quantos ele já trouxe. Sem nome e sem compra: isso é dado de terceiro. */
    indicados: number;
    indicados_ativos: number;
    ganho_indicacao: number;
  };
  contato: { atendente: string | null; grafica: string | null; telefones: string | null; email: string | null };
  marca: MarcaDoParceiro;
  nivel: NivelAtual;
  niveis: NivelDaRegua[];
  saldo_credito: number;
  extrato: LancamentoDeCredito[];
  campanhas: Campanha[];
  conquistas: Conquista[];
  ofertas: Oferta[];
  orcamentos: { total: number; mes: number; abertos: number; pedidos: number };
  pedidos: PedidoDoParceiro[];
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const inteiro = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const decimal = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

// ─── Nível ──────────────────────────────────────────────────────────────────

export type ProgressoDoNivel = {
  /** 0–100, do piso do nível atual ao piso do próximo */
  pct: number;
  maximo: boolean;
  titulo: string;
  detalhe: string;
};

export function progressoDoNivel(nivel: NivelAtual, niveis: NivelDaRegua[]): ProgressoDoNivel {
  const compras = n(nivel.compras_90d);
  if (!nivel.proximo) {
    return {
      pct: 100,
      maximo: true,
      titulo: `Você está no nível mais alto${nivel.nome ? `: ${nivel.nome}` : ""}`,
      detalhe: `${brl(compras)} em compras nos últimos 90 dias.`,
    };
  }
  const pisoAtual = n(niveis.find((x) => x.id === nivel.id)?.compra_minima_90d);
  const pisoProximo = n(nivel.proximo.compra_minima_90d);
  const faixa = pisoProximo - pisoAtual;
  const andado = faixa > 0 ? ((compras - pisoAtual) / faixa) * 100 : 0;
  return {
    pct: pct(andado),
    maximo: false,
    titulo: `Faltam ${brl(n(nivel.proximo.falta))} para ${nivel.proximo.nome}`,
    detalhe:
      `${brl(compras)} em compras nos últimos 90 dias. ` +
      `No ${nivel.proximo.nome} o desconto sobe para ${decimal(n(nivel.proximo.desconto_pct))}%.`,
  };
}

// ─── Metas ──────────────────────────────────────────────────────────────────

export function quantidadeDaMetrica(metrica: MetricaDaMeta, valor: number): string {
  switch (metrica) {
    case "valor_compras":
      return brl(valor);
    case "metragem_compras":
      return `${decimal(valor)} m²`;
    case "quantidade_pedidos":
      return `${inteiro(valor)} ${Math.round(valor) === 1 ? "pedido" : "pedidos"}`;
  }
}

export function textoDaRecompensa(c: Pick<Campanha, "recompensa_tipo" | "recompensa_valor" | "recompensa_descricao">): string {
  if (c.recompensa_tipo === "credito" && c.recompensa_valor) {
    return `${brl(n(c.recompensa_valor))} em crédito`;
  }
  return c.recompensa_descricao;
}

export type ProgressoDaMeta = {
  pct: number;
  conquistada: boolean;
  /** "R$ 800,00 de R$ 1.000,00" */
  andamento: string;
  /** "Faltam R$ 200,00" ou "Meta batida" */
  falta: string;
  /** "Termina hoje", "Faltam 12 dias", "Encerrada" */
  prazo: string;
};

export function progressoDaMeta(c: Campanha, agora = new Date()): ProgressoDaMeta {
  const atual = n(c.atual);
  const meta = n(c.meta);
  const batida = c.conquistada || (meta > 0 && atual >= meta);
  const dias = diasAte(c.fim, agora);
  const prazo =
    dias === null ? "" : dias < 0 ? "Encerrada" : dias === 0 ? "Termina hoje" : dias === 1 ? "Termina amanhã" : `Faltam ${dias} dias`;
  return {
    pct: batida ? 100 : meta > 0 ? pct((atual / meta) * 100) : 0,
    conquistada: batida,
    andamento: `${quantidadeDaMetrica(c.metrica, atual)} de ${quantidadeDaMetrica(c.metrica, meta)}`,
    falta: batida ? "Meta batida" : `Faltam ${quantidadeDaMetrica(c.metrica, Math.max(meta - atual, 0))}`,
    prazo,
  };
}

// ─── Ofertas ────────────────────────────────────────────────────────────────

/** As que abrem sozinhas: marcadas para aviso e ainda não vistas, a que acaba antes primeiro. */
export function ofertasParaAvisar(ofertas: Oferta[]): Oferta[] {
  return ofertas
    .filter((o) => o.exibir_popup && !o.vista)
    .sort((a, b) => new Date(a.fim).getTime() - new Date(b.fim).getTime());
}

/** "Lona 440g por R$ 55,00/m² até 30/09" */
export function resumoDaOferta(o: Oferta): string {
  const ate = new Date(o.fim).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (o.produto_nome && o.preco_oferta) {
    const un = o.produto_unidade && /^m(2|²)$/i.test(o.produto_unidade.trim()) ? "m²" : (o.produto_unidade ?? "un");
    return `${o.produto_nome} por ${brl(n(o.preco_oferta))}/${un} até ${ate}`;
  }
  return `${o.titulo} — até ${ate}`;
}

// ─── Pedidos ────────────────────────────────────────────────────────────────

export const PASSOS_DO_PEDIDO = ["Recebido", "Arte", "Produção", "Acabamento", "Pronto"] as const;

export type SituacaoDoPedido = {
  rotulo: string;
  /** índice em PASSOS_DO_PEDIDO; nulo quando o pedido saiu do caminho */
  passo: number | null;
  tom: "cyan" | "magenta" | "lime" | "amber" | "muted";
};

/**
 * Onde o pedido está, em palavras do parceiro.
 *
 * O pedido nasce como orçamento aprovado na gráfica e só entra na produção quando
 * a equipe gera a OS. Até lá ele está "recebido"; depois, a etapa vem do status
 * da OS pelas mesmas cinco etapas do quadro de produção.
 */
export function situacaoDoPedido(p: Pick<PedidoDoParceiro, "pedido_status" | "os_status">): SituacaoDoPedido {
  if (p.pedido_status === "rejeitado") return { rotulo: "Recusado pela gráfica", passo: null, tom: "muted" };
  if (p.pedido_status === "expirado") return { rotulo: "Expirou sem produção", passo: null, tom: "muted" };
  if (!p.os_status) return { rotulo: "Recebido — aguardando produção", passo: 0, tom: "cyan" };

  if (p.os_status === "cancelado") return { rotulo: "Cancelado", passo: null, tom: "muted" };
  if (p.os_status === "pausado") return { rotulo: "Pausado — fale com a gráfica", passo: null, tom: "amber" };
  if (p.os_status === "concluido" || p.os_status === "faturado") {
    return { rotulo: "Entregue", passo: 4, tom: "lime" };
  }
  switch (etapaDe(p.os_status)) {
    case "entrada":
      return { rotulo: "Recebido", passo: 0, tom: "cyan" };
    case "pre_impressao":
      return p.os_status === "aguardando_aprovacao_arte"
        ? { rotulo: "Arte esperando aprovação", passo: 1, tom: "amber" }
        : { rotulo: "Preparando a arte", passo: 1, tom: "cyan" };
    case "producao":
      return { rotulo: "Em produção", passo: 2, tom: "magenta" };
    case "acabamento":
      return { rotulo: "No acabamento", passo: 3, tom: "magenta" };
    case "saida":
      return { rotulo: "Pronto para sair", passo: 4, tom: "lime" };
    default:
      return { rotulo: "Em andamento", passo: 0, tom: "cyan" };
  }
}

// ─── Orçamentos do parceiro ─────────────────────────────────────────────────

export type StatusDoOrcamento = "rascunho" | "enviado" | "aprovado" | "perdido" | "pedido_feito";

export const STATUS_DO_ORCAMENTO: Record<StatusDoOrcamento, { rotulo: string; tom: SituacaoDoPedido["tom"] }> = {
  rascunho: { rotulo: "Rascunho", tom: "muted" },
  enviado: { rotulo: "Enviado ao cliente", tom: "cyan" },
  aprovado: { rotulo: "Cliente aprovou", tom: "lime" },
  perdido: { rotulo: "Perdido", tom: "muted" },
  pedido_feito: { rotulo: "Pedido feito", tom: "magenta" },
};

/** Os estados que o próprio parceiro escolhe. "Pedido feito" só nasce do envio. */
export const STATUS_ESCOLHIVEIS: StatusDoOrcamento[] = ["rascunho", "enviado", "aprovado", "perdido"];

/** Data de validade do orçamento: dia da criação + dias de validade. */
export function validadeDoOrcamento(criadoEm: string, validadeDias: number): Date | null {
  const base = dataLocal(criadoEm);
  if (!base) return null;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + Math.max(Number(validadeDias) || 0, 0));
  return d;
}

// ─── Crédito ────────────────────────────────────────────────────────────────

export const ROTULO_DO_CREDITO: Record<TipoDeCredito, string> = {
  // "cashback" na LC 214/2025 é outra coisa (devolução a famílias): no extrato
  // que vai ao contador, o nome é crédito.
  cashback: "Crédito do pedido pago",
  recompensa: "Meta batida",
  uso: "Usado em pedido",
  estorno_uso: "Crédito devolvido",
  ajuste: "Ajuste da gráfica",
};
