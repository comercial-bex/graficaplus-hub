/**
 * O que o cliente vê: o formato do painel e a tradução do status da OS.
 *
 * O painel vem pronto do banco (`portal_painel_do_cliente`), igual para as duas
 * portas — o cliente logado em /portal-cliente e o cliente com link em
 * /publico/$token. É uma lista FECHADA de chaves: número, título, situação,
 * prazo e o VALOR DO PEDIDO (o preço do que ele comprou). Custo, margem,
 * resultado e "receita líquida" não existem nela — a tela antiga do portal
 * mostrava a receita líquida da OS ao cliente, que é número interno de
 * resultado, e lia a view financeira, que só devolve linha para quem tem
 * financeiro.read: o cliente via sempre "Nenhuma OS registrada".
 *
 * Domínio puro: nada de banco, nada de React.
 */
import {
  ROTULO_ETAPA,
  etapaDe,
  osEstaEncerrada,
  osFoiEntregue,
  progressoDaEtapa,
  rotuloDe,
  statusInfo,
  type Etapa,
} from "@/domain/os/etapas";

export type ArteParaAprovar = {
  arquivo_id: string;
  nome: string;
  mime: string | null;
  pedida_em: string;
  vence_em: string;
};

export type ArquivoNoPortal = {
  id: string;
  nome: string;
  tipo: string;
  situacao: string;
  criado_em: string;
  tamanho_bytes: number | null;
  mime: string | null;
  /** Mandado pelo próprio cliente, pelo portal. */
  do_cliente: boolean;
};

export type DocumentoNoPortal = {
  id: string;
  tipo: "os" | "orcamento" | string;
  numero: number | null;
  criado_em: string;
  tamanho_bytes: number | null;
};

export type OrdemNoPortal = {
  id: string;
  numero: number;
  titulo: string | null;
  status: string;
  prazo_entrega: string | null;
  entregue_em: string | null;
  criado_em: string;
  precisa_entrega: boolean;
  precisa_instalacao: boolean;
  /** Preço do pedido. Nunca custo, margem ou resultado. */
  valor_pedido: number | null;
  artes_para_aprovar: ArteParaAprovar[];
  arquivos: ArquivoNoPortal[];
  documentos: DocumentoNoPortal[];
};

export type OrcamentoNoPortal = {
  id: string;
  numero: number;
  titulo: string | null;
  status: string;
  valor_total: number | null;
  criado_em: string;
  enviado_em: string | null;
  validade_dias: number | null;
  /** O link /orcamento-publico/<token>, quando a equipe já gerou. */
  token_publico: string | null;
};

export type SolicitacaoNoPortal = {
  id: string;
  tipo: string;
  mensagem: string;
  status: string;
  criado_em: string;
  os_numero: number | null;
};

export type ComprovanteNoPortal = {
  id: string;
  nome: string;
  situacao: "a_conferir" | "conferido" | "recusado" | string;
  criado_em: string;
  os_numero: number | null;
  /** Só quando recusado: o motivo que o financeiro escreveu para o cliente. */
  motivo: string | null;
};

export type PainelDoCliente = {
  versao: number;
  gerado_em: string;
  cliente: { id: string; nome: string };
  empresa: { nome: string; telefones: string | null; email: string | null };
  ordens: OrdemNoPortal[];
  orcamentos: OrcamentoNoPortal[];
  solicitacoes: SolicitacaoNoPortal[];
  comprovantes: ComprovanteNoPortal[];
};

/** O que `portal_meu_painel` devolve ao cliente logado. */
export type PainelDaConta =
  | { situacao: "sem_acesso" }
  | ({ situacao: "aberto"; clientes: { id: string; nome: string }[] } & PainelDoCliente);

/** O que `GET /api/portal/painel` devolve ao cliente com link. */
export type PainelDoLink = { situacao: "aberto"; vence_em: string } & PainelDoCliente;

/* ------------------------------------------------------------------------- */
/* A situação da OS na língua do cliente                                      */
/* ------------------------------------------------------------------------- */

type Tom = "cyan" | "lime" | "magenta" | "amber" | "muted";

export type SituacaoParaOCliente = {
  /** A etapa (as cinco do quadro) ou "Entregue"/"Cancelado". */
  titulo: string;
  /** Uma frase sobre o que está acontecendo agora. */
  detalhe: string;
  etapa: Etapa | null;
  /** 0 a 1, ou null fora do fluxo (pausada, cancelada). */
  progresso: number | null;
  tom: Tom;
  /** A OS está parada esperando uma ação do próprio cliente. */
  esperaPeloCliente: boolean;
};

/**
 * Frase por status. O cliente não precisa saber de PCP, de "fila de produção"
 * nem de faturado: precisa saber o que está acontecendo com o pedido dele e se
 * falta algo da parte dele. Status fora desta lista cai no rótulo de
 * `etapas.ts` — e um teste confere que todo status do enum tem frase aqui.
 */
const FRASE: Record<string, string> = {
  entrada: "Pedido recebido.",
  aguardando_briefing: "Esperando as informações do pedido para começar a arte.",
  briefing_ok: "Informações conferidas, indo para a arte.",
  design: "A arte está sendo preparada.",
  aguardando_aprovacao_arte: "Esperando você aprovar a arte.",
  arte_aprovada: "Arte aprovada. Vai para a produção.",
  arte_rejeitada: "Ajustando a arte do jeito que você pediu.",
  aguardando_producao: "Arte pronta, aguardando a vez na produção.",
  em_impressao: "Em produção: impressão.",
  em_corte: "Em produção: recorte.",
  em_laser_cnc: "Em produção: corte a laser.",
  em_3d: "Em produção: impressão 3D.",
  em_uv: "Em produção.",
  em_producao: "Em produção.",
  producao: "Em produção.",
  em_acabamento: "No acabamento.",
  controle_qualidade: "Na conferência de qualidade antes de liberar.",
  retrabalho: "Refazendo uma parte para entregar no padrão.",
  aguardando_retirada: "Pronto! Pode retirar na Bex Print.",
  aguardando_entrega: "Pronto, aguardando a saída para entrega.",
  em_entrega: "Saiu para entrega.",
  em_instalacao: "Em instalação.",
  concluido: "Entregue.",
  faturado: "Entregue.",
  pausado: "Pausado. A equipe vai falar com você.",
  cancelado: "Cancelado.",
};

/** Os status em que a bola está com o cliente. */
const ESPERA_O_CLIENTE = new Set([
  "aguardando_aprovacao_arte",
  "aguardando_briefing",
  "aguardando_retirada",
]);

export function situacaoParaOCliente(status: string | null | undefined): SituacaoParaOCliente {
  const etapa = etapaDe(status);
  const esperaPeloCliente = ESPERA_O_CLIENTE.has(status ?? "");
  const detalhe = (status && FRASE[status]) ?? (statusInfo(status) ? `${rotuloDe(status)}.` : "");

  if (status === "cancelado") {
    return {
      titulo: "Cancelado",
      detalhe,
      etapa,
      progresso: null,
      tom: "muted",
      esperaPeloCliente: false,
    };
  }
  if (osFoiEntregue(status)) {
    return {
      titulo: "Entregue",
      detalhe,
      etapa,
      progresso: 1,
      tom: "lime",
      esperaPeloCliente: false,
    };
  }
  if (status === "pausado") {
    return {
      titulo: "Pausado",
      detalhe,
      etapa,
      progresso: null,
      tom: "amber",
      esperaPeloCliente: false,
    };
  }
  return {
    titulo: etapa ? ROTULO_ETAPA[etapa] : rotuloDe(status),
    detalhe,
    etapa,
    progresso: progressoDaEtapa(status),
    tom: esperaPeloCliente ? "amber" : "cyan",
    esperaPeloCliente,
  };
}

/* ------------------------------------------------------------------------- */
/* Contas da tela                                                             */
/* ------------------------------------------------------------------------- */

export function separarOrdens(ordens: OrdemNoPortal[]): {
  abertas: OrdemNoPortal[];
  encerradas: OrdemNoPortal[];
} {
  return {
    abertas: ordens.filter((o) => !osEstaEncerrada(o.status)),
    encerradas: ordens.filter((o) => osEstaEncerrada(o.status)),
  };
}

export type ResumoDoPortal = {
  emAndamento: number;
  entregues: number;
  /** Artes para aprovar + orçamentos para responder + pedidos prontos para retirar. */
  esperandoVoce: number;
  /** Soma do valor dos pedidos em andamento — cancelada e entregue não entram. */
  valorEmAndamento: number;
};

export function resumoDoPortal(
  painel: Pick<PainelDoCliente, "ordens" | "orcamentos">,
): ResumoDoPortal {
  const { abertas } = separarOrdens(painel.ordens);
  const artes = painel.ordens.reduce((s, o) => s + o.artes_para_aprovar.length, 0);
  const orcamentos = painel.orcamentos.filter((o) => o.status === "enviado").length;
  const prontos = abertas.filter((o) => o.status === "aguardando_retirada").length;
  return {
    emAndamento: abertas.length,
    entregues: painel.ordens.filter((o) => osFoiEntregue(o.status)).length,
    esperandoVoce: artes + orcamentos + prontos,
    valorEmAndamento: abertas.reduce((s, o) => s + Number(o.valor_pedido ?? 0), 0),
  };
}

export function formatarReal(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return "—";
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * O valor do pedido como o cliente lê. OS sem item ainda tem total zero (a OS
 * #49 estava assim em 02/10/2026): "R$ 0,00" leria como pedido de graça, e o
 * que é verdade é que o preço ainda não foi lançado.
 */
export function valorDoPedido(valor: number | null | undefined): string {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) && n > 0 ? formatarReal(n) : "a definir";
}

export function formatarTamanho(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** dd/mm/aaaa de um instante (timestamptz), no fuso da gráfica. */
export function formatarDia(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Belem" });
}

const ROTULO_DO_ARQUIVO: Record<string, string> = {
  arte: "Arte",
  referencia: "Referência",
  briefing: "Briefing",
  outro: "Arquivo",
};

export function rotuloDoArquivo(a: Pick<ArquivoNoPortal, "tipo" | "do_cliente">): string {
  const base = ROTULO_DO_ARQUIVO[a.tipo] ?? "Arquivo";
  return a.do_cliente ? `${base} que você mandou` : base;
}

export function rotuloDoDocumento(d: Pick<DocumentoNoPortal, "tipo" | "numero">): string {
  const nome = d.tipo === "os" ? "Ordem de serviço" : "Orçamento";
  return d.numero ? `${nome} nº ${d.numero}` : nome;
}

const ROTULO_DA_SOLICITACAO: Record<string, string> = {
  duvida: "Dúvida",
  alteracao: "Pedido de alteração",
  entrega: "Entrega ou retirada",
  arquivo: "Arquivo",
  pagamento: "Comprovante",
  outro: "Mensagem",
};

export function rotuloDaSolicitacao(tipo: string): string {
  return ROTULO_DA_SOLICITACAO[tipo] ?? "Mensagem";
}

export function rotuloDoAndamento(status: string): { texto: string; tom: Tom } {
  if (status === "resolvida") return { texto: "Respondida", tom: "lime" };
  if (status === "cancelada") return { texto: "Cancelada", tom: "muted" };
  return { texto: "Com a equipe", tom: "cyan" };
}

export function rotuloDoComprovante(situacao: string): { texto: string; tom: Tom } {
  if (situacao === "conferido") return { texto: "Conferido", tom: "lime" };
  if (situacao === "recusado") return { texto: "Recusado", tom: "magenta" };
  return { texto: "Com o financeiro", tom: "cyan" };
}

/** O que a imagem/PDF da arte é, para escolher como mostrar. */
export function tipoDePrevia(
  mime: string | null | undefined,
  nome: string,
): "imagem" | "pdf" | "outro" {
  const m = (mime ?? "").toLowerCase();
  const n = nome.toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(n)) return "imagem";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  return "outro";
}
