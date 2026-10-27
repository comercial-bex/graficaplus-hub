/**
 * Os arquivos de uma OS e a capa do cartão (23/10/2026).
 *
 * O quadro de produção mostrava o título e uma linha de itens, mas não a coisa
 * que vai ser impressa: quem conferia a OS abria a ficha para saber QUE arte era.
 * O cartão agora tem capa — a imagem do arquivo que a produção vai usar.
 *
 * Qual arquivo é a capa (a regra, escrita uma vez):
 *   1. só entra arquivo que o navegador desenha (PNG, JPG, WebP, SVG…; CDR, AI,
 *      PSD e EPS viram ficha com o nome, não capa);
 *   2. versão substituída ou arquivo desativado não entra — a capa não pode ser a
 *      arte que já foi trocada;
 *   3. entre os que sobram: o marcado como FINAL DE PRODUÇÃO primeiro (é o que
 *      vai à máquina), depois o tipo "arte", depois o mais recente.
 */

export type ArquivoDaOs = {
  id: string;
  nome: string;
  caminho: string;
  mime_type: string | null;
  final_producao: boolean | null;
  created_at: string | null;
  tipo?: string | null;
  status?: string | null;
  ativo?: boolean | null;
  substituido_por?: string | null;
  os_item_id?: string | null;
};

export function extensao(nome: string): string {
  return (nome.split(".").pop() ?? "").toLowerCase();
}

/** `caminho` é a reserva quando o nome veio sem extensão (ex.: "Foto do modelo — Kit"). */
export function ehPdf(nome: string, mime?: string | null, caminho?: string | null): boolean {
  return mime === "application/pdf" || extensao(nome) === "pdf" || (!!caminho && extensao(caminho) === "pdf");
}

/** O navegador desenha? (CDR, AI, PSD e EPS não: viram ficha com o nome) */
export function ehImagemVisivel(nome: string, mime?: string | null, caminho?: string | null): boolean {
  if (mime) return mime.startsWith("image/") && !/photoshop|postscript|illustrator/.test(mime);
  const imagens = ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"];
  return imagens.includes(extensao(nome)) || (!!caminho && imagens.includes(extensao(caminho)));
}

/** Vale hoje: não foi substituído por outra versão nem desativado. */
export function arquivoVigente(a: Pick<ArquivoDaOs, "ativo" | "substituido_por">): boolean {
  return a.ativo !== false && !a.substituido_por;
}

/** O arquivo que a produção usa: o final marcado primeiro, depois a arte, depois o mais novo. */
function porPrioridade(a: ArquivoDaOs, b: ArquivoDaOs): number {
  const final = Number(!!b.final_producao) - Number(!!a.final_producao);
  if (final !== 0) return final;
  const arte = Number(b.tipo === "arte") - Number(a.tipo === "arte");
  if (arte !== 0) return arte;
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

/** Os arquivos vigentes, o mais importante primeiro. */
export function arquivosEmOrdem(arquivos: ArquivoDaOs[] | null | undefined): ArquivoDaOs[] {
  return (arquivos ?? []).filter(arquivoVigente).sort(porPrioridade);
}

/** A imagem da capa, ou null quando nenhum arquivo vigente pode ser desenhado. */
export function escolherCapa(arquivos: ArquivoDaOs[] | null | undefined): ArquivoDaOs | null {
  return arquivosEmOrdem(arquivos).find((a) => ehImagemVisivel(a.nome, a.mime_type)) ?? null;
}

/** O que dizer no lugar da capa quando não há imagem: sem arte, ou arte que não se desenha aqui. */
export function semCapa(arquivos: ArquivoDaOs[] | null | undefined): { rotulo: string; detalhe: string | null } {
  const vigentes = arquivosEmOrdem(arquivos);
  if (vigentes.length === 0) return { rotulo: "Sem arte", detalhe: null };
  const primeiro = vigentes[0];
  const ext = extensao(primeiro.nome).toUpperCase();
  return {
    rotulo: ehPdf(primeiro.nome, primeiro.mime_type) ? "PDF" : ext || "Arquivo",
    detalhe: vigentes.length > 1 ? `${vigentes.length} arquivos` : primeiro.nome,
  };
}

export type ResumoDosArquivos = {
  total: number;
  /** marcados como final de produção */
  finais: number;
  temFinal: boolean;
};

export function resumoDosArquivos(arquivos: ArquivoDaOs[] | null | undefined): ResumoDosArquivos {
  const v = arquivosEmOrdem(arquivos);
  const finais = v.filter((a) => a.final_producao).length;
  return { total: v.length, finais, temFinal: finais > 0 };
}
