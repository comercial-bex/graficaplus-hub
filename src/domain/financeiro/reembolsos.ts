import { slugFile } from "@/domain/impressao3d/arquivos";

/**
 * Reembolso: compra feita por alguém da equipe, com o próprio dinheiro, para a
 * gráfica (15/10/2026).
 *
 * As regras moram no banco (migração 20261015140000: reembolso_pedir,
 * reembolso_decidir, reembolso_semaforo). Aqui ficam o que a tela precisa para
 * falar a mesma língua — rótulos, o caminho da foto, a sexta do pagamento — e
 * o espelho de quem decide, para o botão não aparecer a quem o banco recusaria.
 *
 * Decisões do dono:
 *   - SEMÁFORO: a OS continua com a margem mínima (20%) → verde, o financeiro
 *     aprova; aperta a margem, dá prejuízo ou a OS não tem custo → a gerência;
 *   - paga TODA SEXTA: os aprovados viram uma conta a pagar por pessoa;
 *   - foto do cupom ou da nota SEMPRE.
 */

export type CorDoReembolso = "verde" | "amarelo" | "vermelho" | "empresa";
export type SituacaoDoReembolso = "aguardando" | "aprovado" | "recusado" | "pago" | "cancelado";
export type DestinoDoReembolso = "os" | "empresa";
export type CategoriaDoReembolso =
  | "material"
  | "embalagem"
  | "acabamento"
  | "logistica"
  | "terceiros"
  | "retrabalho"
  | "despesa_geral";

/** Onde a foto mora: o Storage só deixa cada um enviar para a própria pasta. */
export const BUCKET_DO_COMPROVANTE = "arquivos-clientes";

/** `reembolsos/<quem pede>/<instante>_<arquivo>` — o banco confere o começo. */
export function caminhoDoComprovante(uid: string, nomeDoArquivo: string, agora = Date.now()): string {
  return `reembolsos/${uid}/${agora}_${slugFile(nomeDoArquivo)}`;
}

/** As categorias de compra para uma OS, na ordem em que aparecem no pedido. */
export const CATEGORIAS_DA_OS: readonly { valor: Exclude<CategoriaDoReembolso, "despesa_geral">; rotulo: string; exemplo: string }[] = [
  { valor: "material", rotulo: "Material", exemplo: "lona, adesivo, tinta, chapa" },
  { valor: "embalagem", rotulo: "Embalagem", exemplo: "sacola, caixa, fita, papel de presente" },
  { valor: "acabamento", rotulo: "Acabamento", exemplo: "ilhós, bastão, cola, parafuso" },
  { valor: "logistica", rotulo: "Entrega e transporte", exemplo: "frete, Uber, combustível" },
  { valor: "terceiros", rotulo: "Serviço de terceiro", exemplo: "corte, solda, pintura fora" },
  { valor: "retrabalho", rotulo: "Refazer (retrabalho)", exemplo: "material para refazer um erro" },
];

export function rotuloDaCategoria(c: string | null | undefined): string {
  if (c === "despesa_geral") return "Despesa da empresa";
  return CATEGORIAS_DA_OS.find((x) => x.valor === c)?.rotulo ?? (c || "—");
}

export const ROTULO_DA_SITUACAO: Record<SituacaoDoReembolso, string> = {
  aguardando: "Esperando decisão",
  aprovado: "Aprovado · paga na sexta",
  recusado: "Recusado",
  pago: "Pago",
  cancelado: "Cancelado",
};

/** Tom do selo (StatusChip) de cada situação. */
export const TOM_DA_SITUACAO: Record<SituacaoDoReembolso, "cyan" | "lime" | "magenta" | "amber" | "muted"> = {
  aguardando: "amber",
  aprovado: "cyan",
  recusado: "magenta",
  pago: "lime",
  cancelado: "muted",
};

export const COR: Record<CorDoReembolso, { rotulo: string; tom: "lime" | "amber" | "magenta" | "muted"; quem: string }> = {
  verde: { rotulo: "Verde", tom: "lime", quem: "o financeiro aprova" },
  amarelo: { rotulo: "Amarelo", tom: "amber", quem: "a gerência decide" },
  vermelho: { rotulo: "Vermelho", tom: "magenta", quem: "a gerência decide, com motivo" },
  empresa: { rotulo: "Empresa", tom: "muted", quem: "o financeiro aprova" },
};

/** "AAAA-MM-DD" de hoje em Macapá/Belém: a data do cupom nunca é amanhã. */
export { hojeNaCasa } from "@/domain/acesso/permissoes-por-pessoa";

/**
 * A sexta em que o aprovado de hoje é pago — a mesma conta do banco
 * (`hoje + ((5 - isodow + 7) % 7)`): na sexta, é a própria sexta.
 */
export function sextaDoPagamento(hoje: string): string {
  const [a, m, d] = hoje.split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  const isodow = data.getUTCDay() === 0 ? 7 : data.getUTCDay();
  data.setUTCDate(data.getUTCDate() + ((5 - isodow + 7) % 7));
  return data.toISOString().slice(0, 10);
}

/** "15,50", "15.50", "R$ 1.234,56" → número; vazio ou inválido → null. */
export function lerValor(texto: string): number | null {
  const limpo = texto.replace(/[R$\s]/g, "");
  if (!limpo) return null;
  // Com vírgula, o ponto é milhar ("1.234,56"); sem vírgula, o ponto é decimal.
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const n = Number(normal);
  return n > 0 ? n : null;
}

/** O que a pessoa pode fazer com reembolsos — as chaves do banco. */
export type QuemDecide = {
  uid: string | null | undefined;
  /** reembolsos.approve: decide qualquer cor. */
  aprovaTudo: boolean;
  /** reembolsos.pay: decide verde e despesa da empresa. */
  aprovaVerde: boolean;
  /** Administrador pode decidir o próprio pedido. */
  ehAdmin: boolean;
};

export type ReembolsoParaDecidir = {
  status: SituacaoDoReembolso;
  cor: CorDoReembolso;
  solicitante_id: string;
};

/**
 * Por que a pessoa NÃO decide este reembolso (null = decide). Espelha
 * reembolso_decidir; o banco confere de novo, e a cor que vale é a de agora
 * (o custo da OS pode ter mudado desde o pedido).
 */
export function motivoParaNaoDecidir(r: ReembolsoParaDecidir, quem: QuemDecide): string | null {
  if (r.status !== "aguardando") return "Este reembolso já foi decidido.";
  if (!quem.aprovaTudo && !quem.aprovaVerde) return "Seu perfil não decide reembolsos.";
  if (r.solicitante_id === quem.uid && !quem.ehAdmin) return "Quem pediu não aprova o próprio reembolso.";
  if ((r.cor === "amarelo" || r.cor === "vermelho") && !quem.aprovaTudo)
    return "Aperta a margem da OS: quem decide é a gerência.";
  return null;
}

/** Recusar sempre pede motivo; aprovar o vermelho (prejuízo) também. */
export function precisaDeMotivo(aprovar: boolean, cor: CorDoReembolso): boolean {
  return !aprovar || cor === "vermelho";
}

/** O que o semáforo devolve (os números só vêm para quem decide). */
export type Semaforo = {
  cor: CorDoReembolso;
  motivo: string;
  quem_aprova: "financeiro" | "gerencia";
  os_fechada: boolean;
  venda?: number;
  custo_antes?: number;
  custo_depois?: number;
  pendentes?: number;
  reembolsado?: number;
  custo_conhecido?: boolean;
  margem_antes?: number | null;
  margem_depois?: number | null;
};

/** "Margem da OS: 28,2% → 26,2%" — só quando o banco mandou os números. */
export function fraseDaMargem(s: Pick<Semaforo, "margem_antes" | "margem_depois" | "custo_conhecido"> | null | undefined): string | null {
  if (!s || s.margem_antes == null || s.margem_depois == null) return null;
  if (s.custo_conhecido === false) return "Custo da OS desconhecido: a margem não diz nada.";
  const pct = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return `Margem da OS: ${pct(Number(s.margem_antes))} → ${pct(Number(s.margem_depois))}`;
}
