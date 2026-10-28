/**
 * Auto-recorte das margens de uma arte — a conta pura, sem canvas.
 *
 * A arte que o vendedor anexa quase nunca é só o produto: é uma captura de
 * tela com meia página branca em volta, um PDF A4 com o logo pequeno no meio,
 * um mockup com margem de respiro. No cartão de layout do documento isso vira
 * um selo minúsculo cercado de nada. Aqui se encontra a caixa do CONTEÚDO —
 * onde a imagem deixa de ser a cor do fundo — para o cartão mostrar só ela.
 *
 * Só recorta quando é seguro:
 *   - os quatro cantos têm a mesma cor (fundo liso: branco, cinza, preto…);
 *     foto de produto sobre a mesa não tem cantos iguais e sai inteira;
 *   - o que sobra é um pedaço razoável da imagem (não um cisco de 1%);
 *   - a margem tirada vale a pena (mais de 3% da área); senão a imagem fica
 *     como está, para não mexer à toa.
 *
 * Os pixels chegam como o canvas entrega (`ImageData.data`: RGBA, linha a
 * linha) — mas aqui é só aritmética, e por isso dá para testar no Node.
 */

export type CaixaDeRecorte = { x: number; y: number; largura: number; altura: number };

export type OpcoesDeRecorte = {
  /** Diferença mínima para o fundo (|Δr|+|Δg|+|Δb|, 0–765) para o pixel contar como conteúdo. */
  tolerancia?: number;
  /** Folga ao redor do conteúdo, como fração do lado maior da imagem. */
  folga?: number;
  /** Área mínima do conteúdo (fração da imagem) para o recorte valer; abaixo disso não recorta. */
  conteudoMinimo?: number;
  /** Só recorta se a caixa final for menor que esta fração da área original. */
  areaMaxima?: number;
};

const PADRAO: Required<OpcoesDeRecorte> = {
  tolerancia: 48,
  folga: 0.02,
  conteudoMinimo: 0.01,
  areaMaxima: 0.97,
};

type Pixels = Uint8ClampedArray | Uint8Array;

function cor(pixels: Pixels, largura: number, x: number, y: number): [number, number, number, number] {
  const i = (y * largura + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

const distancia = (a: [number, number, number, number], b: [number, number, number, number]) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/**
 * A caixa do conteúdo, ou null quando não há o que recortar (fundo não é liso,
 * imagem vazia, conteúdo já ocupa a folha). `pixels` é RGBA de `largura` ×
 * `altura`; pixel transparente conta como fundo.
 */
export function caixaDoConteudo(
  pixels: Pixels,
  largura: number,
  altura: number,
  opcoes: OpcoesDeRecorte = {},
): CaixaDeRecorte | null {
  const o = { ...PADRAO, ...opcoes };
  if (largura < 4 || altura < 4 || pixels.length < largura * altura * 4) return null;

  // O fundo é a cor dos cantos — e os quatro precisam concordar.
  const cantos = [
    cor(pixels, largura, 0, 0),
    cor(pixels, largura, largura - 1, 0),
    cor(pixels, largura, 0, altura - 1),
    cor(pixels, largura, largura - 1, altura - 1),
  ];
  const fundo = cantos[0];
  if (cantos.some((c) => distancia(c, fundo) > o.tolerancia)) return null;

  let minX = largura;
  let minY = altura;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < altura; y++) {
    const linha = y * largura * 4;
    for (let x = 0; x < largura; x++) {
      const i = linha + x * 4;
      // Transparente é fundo, seja qual for a cor por baixo.
      if (pixels[i + 3] < 16) continue;
      const d =
        Math.abs(pixels[i] - fundo[0]) +
        Math.abs(pixels[i + 1] - fundo[1]) +
        Math.abs(pixels[i + 2] - fundo[2]);
      if (d <= o.tolerancia) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  const areaTotal = largura * altura;
  const conteudo = (maxX - minX + 1) * (maxY - minY + 1);
  if (conteudo < o.conteudoMinimo * areaTotal) return null;

  const folga = Math.max(2, Math.round(Math.max(largura, altura) * o.folga));
  const x = Math.max(0, minX - folga);
  const y = Math.max(0, minY - folga);
  const l = Math.min(largura, maxX + 1 + folga) - x;
  const a = Math.min(altura, maxY + 1 + folga) - y;
  if (l * a > o.areaMaxima * areaTotal) return null;
  return { x, y, largura: l, altura: a };
}
