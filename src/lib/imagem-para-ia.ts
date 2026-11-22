import { TIPOS_DE_IMAGEM, type TipoDeImagem } from "@/domain/trofeus/ficha-ia";

/**
 * A IMAGEM DA FICHA, PREPARADA NO NAVEGADOR (22/11/2026). A ficha de um gerador costuma ter 1500 a 2000 pixels de lado;
 * mais que isso só encarece a leitura sem ajudar. Aqui se valida o arquivo, reduz o lado maior e manda em base64. A
 * imagem não é guardada em lugar nenhum: o servidor repassa ao provedor e devolve só os campos lidos.
 */

export const IMAGEM_MAXIMA_BYTES = 10 * 1024 * 1024;
export const LADO_MAXIMO_PX = 1800;
/** Abaixo disto o arquivo original já é leve e segue como veio. */
const ARQUIVO_LEVE_BYTES = 1_500_000;

export type ImagemPreparada = { tipo: TipoDeImagem; base64: string };

export function validarArquivoDeImagem(arquivo: { type: string; size: number }): string | null {
  if (!(TIPOS_DE_IMAGEM as readonly string[]).includes(arquivo.type)) return "Use uma imagem PNG, JPEG ou WEBP.";
  if (arquivo.size > IMAGEM_MAXIMA_BYTES) return "A imagem passa de 10 MB. Use uma menor.";
  if (arquivo.size <= 0) return "O arquivo está vazio.";
  return null;
}

/** As medidas depois de reduzir o lado maior a `max`, mantendo a proporção. Imagem menor que o limite não muda. */
export function dimensoesReduzidas(largura: number, altura: number, max = LADO_MAXIMO_PX): { largura: number; altura: number } {
  const maior = Math.max(largura, altura);
  if (maior <= max) return { largura, altura };
  const f = max / maior;
  return { largura: Math.max(1, Math.round(largura * f)), altura: Math.max(1, Math.round(altura * f)) };
}

function lerComoDataUrl(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result ?? ""));
    leitor.onerror = () => reject(new Error("Não consegui abrir a imagem."));
    leitor.readAsDataURL(arquivo);
  });
}

const semPrefixo = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/** Reduz e converte para JPEG quando a imagem é grande; senão manda o arquivo como está. Falha vira frase em português. */
export async function prepararImagem(arquivo: File): Promise<ImagemPreparada> {
  const problema = validarArquivoDeImagem(arquivo);
  if (problema) throw new Error(problema);
  const original = await lerComoDataUrl(arquivo);
  try {
    const bitmap = await createImageBitmap(arquivo);
    const { largura, altura } = dimensoesReduzidas(bitmap.width, bitmap.height);
    const reduz = largura !== bitmap.width || altura !== bitmap.height;
    if (!reduz && arquivo.size <= ARQUIVO_LEVE_BYTES) {
      bitmap.close();
      return { tipo: arquivo.type as TipoDeImagem, base64: semPrefixo(original) };
    }
    const tela = document.createElement("canvas");
    tela.width = largura;
    tela.height = altura;
    const contexto = tela.getContext("2d");
    if (!contexto) throw new Error("sem canvas");
    contexto.fillStyle = "#ffffff";
    contexto.fillRect(0, 0, largura, altura);
    contexto.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close();
    return { tipo: "image/jpeg", base64: semPrefixo(tela.toDataURL("image/jpeg", 0.9)) };
  } catch {
    // Sem como reduzir (navegador antigo): o original vale se couber no limite do servidor (~5 MB).
    if (arquivo.size > 5 * 1024 * 1024) throw new Error("Não consegui reduzir a imagem. Use uma de até 5 MB.");
    return { tipo: arquivo.type as TipoDeImagem, base64: semPrefixo(original) };
  }
}
