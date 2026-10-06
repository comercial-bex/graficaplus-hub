/**
 * Arte e logo prontas para o PDF.
 *
 * O @react-pdf/renderer só desenha JPEG e PNG. A arte chega como o cliente
 * mandou — WEBP do WhatsApp, PDF do designer, GIF, SVG, HEIC do iPhone — e,
 * passada direto como URL, some do documento ou derruba a renderização inteira.
 * Aqui cada arquivo é baixado e convertido ANTES de desenhar:
 *
 *   JPEG e PNG       passam como estão (data URL), salvo se forem enormes;
 *   outra imagem     o navegador decodifica e um canvas regrava em PNG;
 *   PDF              a 1ª página vira PNG pelo pdf.js;
 *   o que não der    o documento sai com "arte sem prévia: nome.ext".
 *
 * UMA arte ruim nunca derruba o documento: toda falha vira a caixa com o nome,
 * e o resto do PDF sai normal. Roda no navegador, que é onde o PDF é gerado.
 */

import type { DocItem, DocumentoPDFProps } from "./DocumentoPDF";
import { carregarPdfjs } from "./pdfjs";

/** Lado maior da miniatura convertida, em pixels. Sobra para a miniatura impressa. */
const LADO_MAXIMO = 1200;
/** JPEG/PNG até aqui vão como chegaram; acima, são reduzidos (um PNG de impressão passa de 30 MB). */
const PASSA_DIRETO_ATE = 3 * 1024 * 1024;
/** Arquivo maior que isto nem é baixado para a prévia: o celular travaria. */
const MAIOR_ARQUIVO = 60 * 1024 * 1024;
/** PNG convertido maior que isto é regravado em JPEG, para o PDF caber no WhatsApp. */
const PNG_ATE = 1.5 * 1024 * 1024;
const TEMPO_LIMITE_MS = 45_000;

export type Formato =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "bmp"
  | "svg"
  | "pdf"
  | "heic"
  | "avif"
  | "tiff"
  | "desconhecido";

export type ArteNoPDF = { src: string } | { falha: string };

const MIME: Record<Exclude<Formato, "desconhecido">, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  heic: "image/heic",
  avif: "image/avif",
  tiff: "image/tiff",
};

const POR_EXTENSAO: Record<string, Formato> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  jfif: "jpeg",
  png: "png",
  gif: "gif",
  webp: "webp",
  bmp: "bmp",
  svg: "svg",
  pdf: "pdf",
  heic: "heic",
  heif: "heic",
  avif: "avif",
  tif: "tiff",
  tiff: "tiff",
};

const ascii = (b: Uint8Array, de: number, ate: number) =>
  String.fromCharCode(...b.subarray(de, Math.min(ate, b.length)));

/**
 * O formato pelos primeiros bytes; a extensão só desempata.
 *
 * A tabela `arquivos` não guarda o tipo (mime_type está nulo em todas as
 * linhas) e o nome engana: "arte.png" que na verdade é WEBP é o caso comum de
 * quem salva imagem do WhatsApp. Os bytes não mentem.
 */
export function detectarFormato(cabeca: Uint8Array, nome?: string | null): Formato {
  const b = cabeca;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && ascii(b, 1, 4) === "PNG" && b[0] === 0x89) return "png";
  if (ascii(b, 0, 4) === "GIF8") return "gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (ascii(b, 0, 2) === "BM" && b.length > 14) return "bmp";
  if (ascii(b, 0, 4) === "II*\0" || ascii(b, 0, 4) === "MM\0*") return "tiff";
  if (ascii(b, 4, 8) === "ftyp") {
    const marca = ascii(b, 8, 12);
    if (marca === "avif" || marca === "avis") return "avif";
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(marca))
      return "heic";
  }
  // PDF pode ter lixo antes do cabeçalho (a norma tolera até 1 KB).
  const inicio = ascii(b, 0, 1024);
  if (inicio.includes("%PDF-")) return "pdf";
  if (
    /^(\xEF\xBB\xBF)?\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(
      inicio,
    )
  ) {
    return "svg";
  }
  const extensao = (nome ?? "").split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  return POR_EXTENSAO[extensao] ?? "desconhecido";
}

/** Base64 sem FileReader (que não existe fora do navegador), em blocos para não estourar a pilha. */
function base64(bytes: Uint8Array): string {
  let binario = "";
  const bloco = 0x8000;
  for (let i = 0; i < bytes.length; i += bloco) {
    binario += String.fromCharCode(...bytes.subarray(i, i + bloco));
  }
  return btoa(binario);
}

const dataUrl = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${base64(bytes)}`;

async function baixar(url: string): Promise<Uint8Array> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const resposta = await fetch(url, { signal: controle.signal });
    if (!resposta.ok) throw new Error(`não baixou (HTTP ${resposta.status})`);
    const tamanho = Number(resposta.headers.get("content-length") ?? 0);
    if (tamanho > MAIOR_ARQUIVO) {
      throw new Error(`arquivo grande demais para a prévia (${Math.round(tamanho / 1048576)} MB)`);
    }
    return new Uint8Array(await resposta.arrayBuffer());
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * O canvas vira PNG; se o PNG sair pesado (foto grande), JPEG. O fundo já foi
 * pintado de branco, então o JPEG não transforma transparência em preto.
 */
function canvasParaDataUrl(canvas: HTMLCanvasElement): string {
  const png = canvas.toDataURL("image/png");
  if (png.length * 0.75 <= PNG_ATE) return png;
  return canvas.toDataURL("image/jpeg", 0.88);
}

function novoCanvas(largura: number, altura: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(largura));
  canvas.height = Math.max(1, Math.round(altura));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("o navegador não abriu um canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

function carregarImagem(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("o navegador não abre este formato"));
    img.src = url;
  });
}

/** Qualquer imagem que o navegador decodifique, regravada por canvas. */
async function regravarPorCanvas(bytes: Uint8Array, formato: Formato): Promise<string> {
  const tipo = formato === "desconhecido" ? "" : MIME[formato];
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
  try {
    const img = await carregarImagem(url);
    // SVG sem width/height não tem tamanho natural em todo navegador.
    let largura = img.naturalWidth || LADO_MAXIMO;
    let altura = img.naturalHeight || Math.round(LADO_MAXIMO * 0.75);
    // Vetor pode crescer até o lado máximo; foto só diminui.
    const escala =
      formato === "svg"
        ? LADO_MAXIMO / Math.max(largura, altura)
        : Math.min(1, LADO_MAXIMO / Math.max(largura, altura));
    largura *= escala;
    altura *= escala;
    const { canvas, ctx } = novoCanvas(largura, altura);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasParaDataUrl(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 1ª página do PDF como imagem — é o que o designer manda como "arte". */
async function primeiraPaginaDoPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await carregarPdfjs();
  const tarefa = pdfjs.getDocument({ data: bytes });
  try {
    const documento = await tarefa.promise;
    const pagina = await documento.getPage(1);
    const base = pagina.getViewport({ scale: 1 });
    const viewport = pagina.getViewport({ scale: LADO_MAXIMO / Math.max(base.width, base.height) });
    const { canvas } = novoCanvas(viewport.width, viewport.height);
    await pagina.render({ canvas, viewport }).promise;
    return canvasParaDataUrl(canvas);
  } finally {
    await tarefa.destroy();
  }
}

/** Baixa e converte uma arte. Nunca rejeita: falha vira `{ falha }`. */
export async function prepararArte(url: string, nome?: string | null): Promise<ArteNoPDF> {
  try {
    const bytes = await baixar(url);
    const formato = detectarFormato(bytes.subarray(0, 1024), nome ?? url);
    if ((formato === "jpeg" || formato === "png") && bytes.length <= PASSA_DIRETO_ATE) {
      return { src: dataUrl(bytes, MIME[formato]) };
    }
    if (formato === "pdf") return { src: await primeiraPaginaDoPdf(bytes) };
    return { src: await regravarPorCanvas(bytes, formato) };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    // Fica no console para quem for investigar; o documento mostra só o nome.
    console.warn(`[pdf] arte sem prévia (${nome ?? "sem nome"}): ${motivo}`);
    return { falha: motivo };
  }
}

/** Até `limite` conversões ao mesmo tempo: dez fotos grandes de uma vez estouram a memória do celular. */
async function emLotes<T, R>(
  lista: T[],
  limite: number,
  fazer: (item: T) => Promise<R>,
): Promise<R[]> {
  const saida: R[] = new Array(lista.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < lista.length) {
      const i = proximo++;
      saida[i] = await fazer(lista[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, lista.length) }, trabalhador));
  return saida;
}

/**
 * Troca logo e capas por data URLs JPEG/PNG. Chamado por `renderPDFBlob`, então
 * vale para todo documento gerado no navegador — inclusive o do parceiro.
 */
export async function prepararImagensDoDocumento(p: DocumentoPDFProps): Promise<DocumentoPDFProps> {
  const [logo, itens] = await Promise.all([
    p.empresa.logo_url ? prepararArte(p.empresa.logo_url, "logo") : Promise.resolve(null),
    emLotes(p.itens, 3, async (item): Promise<DocItem> => {
      if (!item.layout_url || item.layout_sem_previa) return item;
      const arte = await prepararArte(item.layout_url, item.layout_nome);
      return "src" in arte
        ? { ...item, layout_url: arte.src }
        : { ...item, layout_url: null, layout_sem_previa: true };
    }),
  ]);
  return {
    ...p,
    // Logo que não converte some e o cabeçalho cai na caixa com o nome.
    empresa: { ...p.empresa, logo_url: logo && "src" in logo ? logo.src : null },
    itens,
  };
}
