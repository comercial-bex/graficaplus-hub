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
  /** Nulo nas linhas antigas: vale `arquivos-clientes` (ver `bucketDoArquivo`). */
  bucket?: string | null;
  tamanho_bytes?: number | null;
  versao?: number | null;
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

/* ------------------------------------------------------------------ */
/* Mockup × arquivo de impressão (14/11/2026)                          */
/* ------------------------------------------------------------------ */

/**
 * Pedido do dono (14/11/2026): "que esteja nítido para a produção o que é o
 * visual de visualização — o que a gente vende, o mockup aplicado — e o arquivo
 * que vai para impressão ou diagramação".
 *
 * A ficha do quadro mostrava tudo num bloco só ("Arte · o que vai ser impresso"):
 * o mockup do orçamento (a placa aplicada na fachada, o copo com a marca) ficava
 * do lado do PDF que vai para a máquina, sem dizer qual era qual. É a separação
 * que os sistemas de gráfica fazem (YoPrint: "Mockup Files" × "Production
 * Files"; Printavo: mockup visível ao cliente × arquivo de produção interno):
 *
 *   - ARQUIVO DE IMPRESSÃO: o que vai para a máquina. É o marcado como final de
 *     produção (o mesmo sinal que a trava "Sem arquivo final" lê) ou o enviado
 *     com o tipo "producao". Pode ser qualquer formato (PDF, CDR, AI, 3MF…).
 *   - MOCKUP: o que o cliente vê e aprova — tipo "arte" (os layouts do
 *     orçamento) ou "referencia" (a foto do modelo 3D).
 *   - ANEXO: o resto (briefing, comprovante, o que veio pelo WhatsApp).
 *
 * Um arquivo pode ser as duas coisas (a imagem aprovada é a que se imprime):
 * aparece nos dois lugares, e a ficha diz que é o mesmo.
 */
export function ehArquivoDeImpressao(a: Pick<ArquivoDaOs, "final_producao" | "tipo">): boolean {
  return !!a.final_producao || a.tipo === "producao";
}

export function ehMockup(a: Pick<ArquivoDaOs, "tipo">): boolean {
  return a.tipo === "arte" || a.tipo === "referencia";
}

export type ArquivosSeparados = {
  /** O que vai para a máquina: a versão mais nova de cada arquivo. */
  impressao: ArquivoDaOs[];
  /** Mesmo nome (e mesmo item), versão mais velha: não é para imprimir. */
  versoesAnteriores: ArquivoDaOs[];
  /** O que o cliente vê e aprova; o aprovado primeiro. */
  mockups: ArquivoDaOs[];
  /** Briefing, comprovante, o que veio pelo WhatsApp… */
  anexos: ArquivoDaOs[];
};

const maisNovo = (a: ArquivoDaOs, b: ArquivoDaOs) =>
  (b.versao ?? 1) - (a.versao ?? 1) || (b.created_at ?? "").localeCompare(a.created_at ?? "");

/**
 * Separa os arquivos vigentes da OS. Versões: dois arquivos de impressão com o
 * mesmo nome no mesmo item são o mesmo arquivo em versões diferentes — vale o
 * mais novo (a OS 174 tinha três cópias do mesmo JPG, todas "final").
 */
export function separarArquivos(arquivos: ArquivoDaOs[] | null | undefined): ArquivosSeparados {
  const vigentes = (arquivos ?? []).filter(arquivoVigente);
  const deImpressao = vigentes.filter(ehArquivoDeImpressao).sort(maisNovo);
  const impressao: ArquivoDaOs[] = [];
  const versoesAnteriores: ArquivoDaOs[] = [];
  const vistos = new Set<string>();
  for (const a of deImpressao) {
    const chave = `${a.os_item_id ?? ""}|${a.nome.trim().toLowerCase()}`;
    if (vistos.has(chave)) versoesAnteriores.push(a);
    else {
      vistos.add(chave);
      impressao.push(a);
    }
  }
  const mockups = vigentes
    .filter(ehMockup)
    .sort((a, b) => Number(b.status === "aprovado") - Number(a.status === "aprovado") || maisNovo(a, b));
  const anexos = vigentes
    .filter((a) => !ehArquivoDeImpressao(a) && !ehMockup(a))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return { impressao, versoesAnteriores, mockups, anexos };
}

/** O bucket do arquivo: as linhas antigas têm `bucket` nulo e moram em `arquivos-clientes`. */
export function bucketDoArquivo(a: Pick<ArquivoDaOs, "bucket">): string {
  return a.bucket?.trim() || "arquivos-clientes";
}

/**
 * O nome com que o arquivo chega no computador de quem baixa. Sem extensão no
 * nome ("Foto do modelo — Kit"), usa a do caminho, senão o sistema operacional
 * não sabe com o que abrir.
 */
export function nomeParaBaixar(a: Pick<ArquivoDaOs, "nome" | "caminho">): string {
  const nome = (a.nome ?? "").trim() || "arquivo";
  if (extensao(nome) && nome.includes(".")) return nome;
  const doCaminho = extensao(a.caminho ?? "");
  return doCaminho && (a.caminho ?? "").includes(".") ? `${nome}.${doCaminho}` : nome;
}

/** "PDF", "CDR", "3MF"… — o formato em uma palavra, para o operador saber o que vai abrir. */
export function formatoDoArquivo(a: Pick<ArquivoDaOs, "nome" | "mime_type" | "caminho">): string {
  if (ehPdf(a.nome, a.mime_type, a.caminho)) return "PDF";
  const nome = nomeParaBaixar(a);
  const ext = nome.includes(".") ? extensao(nome) : "";
  return ext && ext.length <= 5 ? ext.toUpperCase() : "Arquivo";
}
