/**
 * O documento que chega pelo WhatsApp, como o cartão da bolha o descreve
 * (onda 1, 12/11/2026, dono MIDIA).
 *
 * Funções puras: o tipo do arquivo pelo nome, a descrição "PDF · 18 páginas"
 * com SÓ o que se sabe, o limite de 15 MB para desenhar a capa, a leitura do
 * arquivo que desiste ao passar do limite, a fila de uma capa por vez e o
 * guarda das capas já desenhadas. O desenho em si (pdf.js e canvas) mora em
 * `src/lib/pdf/imagens.ts` e o cartão, em `capa-do-documento.tsx`.
 */

/** PDF maior que isto não tem a capa desenhada: o celular travaria. */
export const LIMITE_DA_CAPA_BYTES = 15 * 1024 * 1024;

export type TipoDeArquivo =
  | "pdf"
  | "imagem"
  | "word"
  | "planilha"
  | "apresentacao"
  | "compactado"
  | "projeto"
  | "outro";

export const ROTULO_DO_ARQUIVO: Record<TipoDeArquivo, string> = {
  pdf: "PDF",
  imagem: "Imagem",
  word: "Word",
  planilha: "Planilha",
  apresentacao: "Apresentação",
  compactado: "Compactado",
  projeto: "Projeto",
  outro: "Arquivo",
};

const POR_EXTENSAO: Record<string, TipoDeArquivo> = {
  pdf: "pdf",
  jpg: "imagem",
  jpeg: "imagem",
  png: "imagem",
  webp: "imagem",
  gif: "imagem",
  bmp: "imagem",
  svg: "imagem",
  doc: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  xls: "planilha",
  xlsx: "planilha",
  csv: "planilha",
  ods: "planilha",
  ppt: "apresentacao",
  pptx: "apresentacao",
  odp: "apresentacao",
  key: "apresentacao",
  zip: "compactado",
  rar: "compactado",
  "7z": "compactado",
  gz: "compactado",
  tar: "compactado",
  // Arquivos de arte e de impressão 3D que a gráfica recebe como "documento".
  cdr: "projeto",
  ai: "projeto",
  psd: "projeto",
  indd: "projeto",
  eps: "projeto",
  dwg: "projeto",
  dxf: "projeto",
  stl: "projeto",
  "3mf": "projeto",
  obj: "projeto",
};

const POR_MIME: Record<string, TipoDeArquivo> = {
  "application/pdf": "pdf",
  "image/jpeg": "imagem",
  "image/png": "imagem",
  "image/webp": "imagem",
  "image/gif": "imagem",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/vnd.ms-excel": "planilha",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "planilha",
  "application/vnd.ms-powerpoint": "apresentacao",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "apresentacao",
  "application/zip": "compactado",
  "application/x-zip-compressed": "compactado",
  "application/x-rar-compressed": "compactado",
};

/** A extensão do nome ("Planta Final.PDF" vira "pdf"); vazio quando não há. */
export function extensaoDoNome(nome: string): string {
  const base = nome.split(/[?#]/)[0];
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(base.trim());
  return m ? m[1].toLowerCase() : "";
}

/** O tipo do arquivo pelo nome; sem extensão que se conheça, pelo mimeType; senão "outro". */
export function tipoDoArquivo(nome: string, mime?: string | null): TipoDeArquivo {
  const porNome = POR_EXTENSAO[extensaoDoNome(nome)];
  if (porNome) return porNome;
  const porMime = mime ? POR_MIME[mime.toLowerCase().split(";")[0].trim()] : undefined;
  return porMime ?? "outro";
}

/** Como a capa se resolve: desenhar o PDF, mostrar a própria imagem, ou dizer "Sem prévia". */
export type ModoDaCapa = "pdf" | "imagem" | "sem_previa";

/**
 * Decide ANTES de baixar. PDF com tamanho conhecido acima do limite não é
 * baixado. Tamanho desconhecido (`null`) passa, e a leitura desiste ao passar
 * do limite (`lerComLimite`).
 */
export function modoDaCapa(tipo: TipoDeArquivo, bytes: number | null): ModoDaCapa {
  if (tipo === "imagem") return "imagem";
  if (tipo !== "pdf") return "sem_previa";
  if (bytes !== null && bytes > LIMITE_DA_CAPA_BYTES) return "sem_previa";
  return "pdf";
}

/** "2,3 MB", "340 KB": vírgula decimal, uma casa só quando ajuda. */
export function tamanhoLegivel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1).replace(".", ",")} MB`;
}

/**
 * "PDF · 18 páginas · 2,3 MB". Só entra o que se sabe: sem a contagem de
 * páginas nem o tamanho, sai só "PDF". Nunca inventa número.
 */
export function descricaoDoDocumento(d: {
  tipo: TipoDeArquivo;
  paginas?: number | null;
  bytes?: number | null;
}): string {
  const partes: string[] = [ROTULO_DO_ARQUIVO[d.tipo]];
  if (d.paginas && d.paginas > 0) partes.push(d.paginas === 1 ? "1 página" : `${d.paginas} páginas`);
  if (d.bytes && d.bytes > 0) {
    const t = tamanhoLegivel(d.bytes);
    if (t) partes.push(t);
  }
  return partes.join(" · ");
}

export class ArquivoGrandeDemais extends Error {
  constructor(public readonly limite: number) {
    super(`arquivo acima de ${tamanhoLegivel(limite)}`);
    this.name = "ArquivoGrandeDemais";
  }
}

/**
 * Lê o corpo de uma resposta e desiste ao passar do limite. Olha o
 * `content-length` antes de ler (não baixa nada se já se sabe que é grande) e,
 * sem ele, conta os bytes enquanto chegam.
 */
export async function lerComLimite(
  resposta: Pick<Response, "headers" | "body" | "arrayBuffer">,
  limite: number = LIMITE_DA_CAPA_BYTES,
): Promise<Uint8Array> {
  const declarado = Number(resposta.headers.get("content-length") ?? 0);
  if (declarado > limite) {
    await resposta.body?.cancel().catch(() => {});
    throw new ArquivoGrandeDemais(limite);
  }
  if (!resposta.body) {
    const tudo = new Uint8Array(await resposta.arrayBuffer());
    if (tudo.length > limite) throw new ArquivoGrandeDemais(limite);
    return tudo;
  }
  const leitor = resposta.body.getReader();
  const blocos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > limite) {
      await leitor.cancel().catch(() => {});
      throw new ArquivoGrandeDemais(limite);
    }
    blocos.push(value);
  }
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const b of blocos) {
    saida.set(b, pos);
    pos += b.length;
  }
  return saida;
}

/**
 * Uma capa por vez: dez documentos na tela não abrem dez pdf.js ao mesmo tempo
 * (o celular trava). Quem ficou esperando e saiu da tela (`cancelado()`) nem
 * começa: a vez passa para o próximo.
 */
export function criarFilaDeUm() {
  let cauda: Promise<unknown> = Promise.resolve();
  return function emFila<T>(fazer: () => Promise<T>, cancelado?: () => boolean): Promise<T> {
    const minha = cauda.then(() => {
      if (cancelado?.()) throw new Error("cancelado");
      return fazer();
    });
    // A fila segue mesmo quando uma capa falha ou é cancelada.
    cauda = minha.catch(() => {});
    return minha;
  };
}

/** Guarda as últimas capas desenhadas (uma imagem em data URL pesa 50 a 150 KB). */
export function criarGuardaDeCapas<V>(maximo = 40) {
  const mapa = new Map<string, V>();
  return {
    ler(chave: string): V | undefined {
      const v = mapa.get(chave);
      if (v === undefined) return undefined;
      // A lida volta para o fim: sai primeiro a que ninguém olha há mais tempo.
      mapa.delete(chave);
      mapa.set(chave, v);
      return v;
    },
    gravar(chave: string, valor: V) {
      mapa.delete(chave);
      mapa.set(chave, valor);
      while (mapa.size > maximo) {
        const primeira = mapa.keys().next().value as string;
        mapa.delete(primeira);
      }
    },
    get tamanho() {
      return mapa.size;
    },
  };
}
