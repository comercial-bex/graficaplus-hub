/**
 * Que arquivo é a arte, se dá para mostrar a miniatura, e em que pé ela está.
 *
 * Puro de propósito (sem React, sem Supabase): é o que decide se o cartão da
 * fila de Design mostra a PEÇA ou um ícone — e o defeito que esta tela tinha
 * era justamente mostrar um ícone fixo no lugar de toda arte, de modo que se
 * aprovava sem ver o que ia para a máquina.
 */
import { etapaDe, osEstaEncerrada } from "@/domain/os/etapas";

export type TipoDeArte = "imagem" | "pdf" | "ai" | "psd" | "cdr" | "outro";

const POR_EXTENSAO: Record<string, TipoDeArte> = {
  png: "imagem",
  jpg: "imagem",
  jpeg: "imagem",
  gif: "imagem",
  webp: "imagem",
  svg: "imagem",
  avif: "imagem",
  bmp: "imagem",
  pdf: "pdf",
  ai: "ai",
  eps: "ai",
  psd: "psd",
  cdr: "cdr",
};

const ROTULO: Record<TipoDeArte, string> = {
  imagem: "Imagem",
  pdf: "PDF",
  ai: "Illustrator",
  psd: "Photoshop",
  cdr: "CorelDRAW",
  outro: "Arquivo",
};

/**
 * Acima disto o cartão não baixa a imagem sozinho: a fila mostraria várias
 * fotos de 20 MB no celular da oficina. Abre-se pelo botão.
 */
export const LIMITE_MINIATURA_BYTES = 10 * 1024 * 1024;

/** O bucket onde as artes moram. `arquivos.bucket` está nulo em todas as linhas (02/10/2026). */
export const BUCKET_PADRAO = "arquivos-clientes";

export type ArquivoDaArte = {
  nome?: string | null;
  caminho?: string | null;
  mime_type?: string | null;
  mime?: string | null;
  tamanho_bytes?: number | null;
  tamanho?: number | null;
};

export function extensaoDe(nome: string | null | undefined): string {
  const base = (nome ?? "").split("/").pop() ?? "";
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

function tipoPeloMime(mime: string): TipoDeArte | null {
  const m = mime.toLowerCase();
  if (!m) return null;
  if (m === "application/pdf") return "pdf";
  if (m.includes("illustrator") || m === "application/postscript") return "ai";
  if (m.includes("photoshop")) return "psd";
  if (m.includes("coreldraw") || m.includes("cdr")) return "cdr";
  // TIFF é imagem, mas o Chrome não desenha: vira "Abrir", não miniatura quebrada.
  if (m.startsWith("image/") && !m.includes("tiff")) return "imagem";
  return null;
}

/**
 * A extensão do NOME vem primeiro: um .ai salvo com compatibilidade PDF chega
 * como application/pdf, e quem enviou disse que é Illustrator. Depois o tipo
 * MIME, depois a extensão do caminho no bucket (o upload do orçamento troca o
 * nome do arquivo por um número, mas mantém a extensão).
 */
export function tipoDaArte(a: ArquivoDaArte): TipoDeArte {
  const peloNome = POR_EXTENSAO[extensaoDe(a.nome)];
  if (peloNome) return peloNome;
  const peloMime = tipoPeloMime(a.mime_type ?? a.mime ?? "");
  if (peloMime) return peloMime;
  return POR_EXTENSAO[extensaoDe(a.caminho)] ?? "outro";
}

export function rotuloDoTipo(tipo: TipoDeArte): string {
  return ROTULO[tipo];
}

export function tamanhoDaArte(a: ArquivoDaArte): number | null {
  const n = a.tamanho_bytes ?? a.tamanho;
  return n == null ? null : Number(n);
}

/** Só imagem que o navegador desenha, e não grande demais para a fila. */
export function mostraMiniatura(a: ArquivoDaArte): boolean {
  if (tipoDaArte(a) !== "imagem") return false;
  const tamanho = tamanhoDaArte(a);
  return tamanho == null || tamanho <= LIMITE_MINIATURA_BYTES;
}

export function tamanhoLegivel(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

export function bucketDaArte(bucket: string | null | undefined): string {
  return bucket?.trim() ? bucket.trim() : BUCKET_PADRAO;
}

/** Os três estados que `status_arquivo` dá a uma arte ainda na fila. */
export type SituacaoDaArte = {
  chave: "ajuste" | "aguardando" | "aprovada";
  rotulo: string;
  tom: "magenta" | "cyan" | "lime";
  /** Ajuste pedido primeiro: é trabalho parado esperando o design. */
  ordem: number;
};

export function situacaoDaArte(status: string | null | undefined): SituacaoDaArte {
  if (status === "rejeitado")
    return { chave: "ajuste", rotulo: "Ajuste pedido", tom: "magenta", ordem: 0 };
  if (status === "aprovado")
    return { chave: "aprovada", rotulo: "Aprovada — falta concluir", tom: "lime", ordem: 2 };
  return { chave: "aguardando", rotulo: "Aguardando aprovação", tom: "cyan", ordem: 1 };
}

/**
 * O orçamento de uma arte que ainda não virou OS.
 *
 * `arquivos` não tem orcamento_id; as duas telas que enviam arte de orçamento
 * gravam o caminho como `orcamento/<id do orçamento>/…`. Só LÊ essa convenção
 * para oferecer o link — não grava vínculo nenhum.
 */
export function orcamentoDoCaminho(caminho: string | null | undefined): string | null {
  const m = /^orcamento\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i.exec(
    caminho ?? "",
  );
  return m ? m[1] : null;
}

/**
 * Registrar a decisão faz a OS RECUAR?
 *
 * `registrar_aprovacao_interna` põe a OS em arte_aprovada (ou arte_rejeitada)
 * sempre que ela não está concluída, faturada ou cancelada — inclusive se já
 * estiver na máquina. A tela avisa antes, em vez de deixar o quadro andar para
 * trás calado.
 */
export function decisaoRecuaAOs(statusOs: string | null | undefined): boolean {
  if (!statusOs || osEstaEncerrada(statusOs)) return false;
  const etapa = etapaDe(statusOs);
  return (
    etapa === "producao" || etapa === "acabamento" || etapa === "saida" || etapa === "fora_do_fluxo"
  );
}

export type DecisaoRegistrada = {
  decisao: string;
  comentario: string | null;
  canal: string | null;
  created_at: string;
};

/** A decisão mais recente do histórico da peça (arquivo_aprovacoes). */
export function ultimaDecisao(
  lista: DecisaoRegistrada[] | null | undefined,
): DecisaoRegistrada | null {
  if (!lista || lista.length === 0) return null;
  return [...lista].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

/** O que o cliente (ou a equipe) pediu para mudar, da decisão mais recente de ajuste. */
export function pedidoDeAjuste(lista: DecisaoRegistrada[] | null | undefined): string | null {
  const ajustes = (lista ?? []).filter((d) => d.decisao === "ajuste" || d.decisao === "reprovado");
  return ultimaDecisao(ajustes)?.comentario ?? null;
}
