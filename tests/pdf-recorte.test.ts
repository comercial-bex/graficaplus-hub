import { describe, expect, it } from "vitest";
import { caixaDoConteudo } from "../src/lib/pdf/recorte";

/**
 * O auto-recorte das margens da arte (recorte.ts): a conta pura, com imagens
 * desenhadas na mão. O que ele promete: tirar a folha branca em volta do
 * conteúdo, e NÃO mexer quando o fundo não é liso ou quando não há margem.
 */

/** Imagem RGBA `largura` × `altura` de uma cor só. */
function imagem(largura: number, altura: number, fundo: [number, number, number, number]) {
  const pixels = new Uint8ClampedArray(largura * altura * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = fundo[0];
    pixels[i + 1] = fundo[1];
    pixels[i + 2] = fundo[2];
    pixels[i + 3] = fundo[3];
  }
  const pintar = (x0: number, y0: number, x1: number, y1: number, cor: [number, number, number, number]) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * largura + x) * 4;
        pixels[i] = cor[0];
        pixels[i + 1] = cor[1];
        pixels[i + 2] = cor[2];
        pixels[i + 3] = cor[3];
      }
    }
  };
  return { pixels, pintar };
}

const BRANCO: [number, number, number, number] = [255, 255, 255, 255];
const AZUL: [number, number, number, number] = [30, 90, 200, 255];

describe("auto-recorte das margens", () => {
  it("captura de tela com a peça no meio: fica só a peça, com folga", () => {
    const { pixels, pintar } = imagem(400, 300, BRANCO);
    pintar(150, 100, 250, 180, AZUL); // peça de 100 × 80 no meio
    const caixa = caixaDoConteudo(pixels, 400, 300);
    expect(caixa).not.toBeNull();
    // folga = 2% do lado maior (400) = 8 px em volta
    expect(caixa).toEqual({ x: 142, y: 92, largura: 116, altura: 96 });
  });

  it("a folga não sai da imagem quando a peça encosta na borda", () => {
    const { pixels, pintar } = imagem(400, 300, BRANCO);
    pintar(0, 100, 100, 180, AZUL); // encosta na esquerda, os cantos seguem brancos
    expect(caixaDoConteudo(pixels, 400, 300)).toEqual({ x: 0, y: 92, largura: 108, altura: 96 });
  });

  it("peça que cobre um canto não tem fundo liso: fica inteira", () => {
    const { pixels, pintar } = imagem(400, 300, BRANCO);
    pintar(0, 0, 100, 80, AZUL);
    expect(caixaDoConteudo(pixels, 400, 300)).toBeNull();
  });

  it("fundo que não é liso (cantos diferentes) fica inteiro", () => {
    const { pixels, pintar } = imagem(400, 300, BRANCO);
    pintar(0, 0, 200, 300, [200, 200, 200, 255]); // metade cinza: foto sobre a mesa
    pintar(150, 100, 250, 180, AZUL);
    expect(caixaDoConteudo(pixels, 400, 300)).toBeNull();
  });

  it("arte que já ocupa a folha não é recortada à toa", () => {
    const { pixels, pintar } = imagem(400, 300, BRANCO);
    pintar(4, 4, 396, 296, AZUL); // 1% de margem
    expect(caixaDoConteudo(pixels, 400, 300)).toBeNull();
  });

  it("imagem vazia ou com um cisco só fica como está", () => {
    const vazia = imagem(400, 300, BRANCO);
    expect(caixaDoConteudo(vazia.pixels, 400, 300)).toBeNull();
    const cisco = imagem(400, 300, BRANCO);
    cisco.pintar(200, 150, 203, 152, AZUL); // 6 pixels em 120 mil
    expect(caixaDoConteudo(cisco.pixels, 400, 300)).toBeNull();
  });

  it("ruído de JPEG perto do branco não conta como conteúdo", () => {
    const { pixels, pintar } = imagem(400, 300, BRANCO);
    pintar(0, 0, 400, 300, [248, 250, 247, 255]); // quase branco, como sai do JPEG
    pintar(150, 100, 250, 180, AZUL);
    // os cantos ainda são "o fundo" (quase branco), e a peça é o único conteúdo
    expect(caixaDoConteudo(pixels, 400, 300)).toEqual({ x: 142, y: 92, largura: 116, altura: 96 });
  });

  it("pixel transparente é fundo, seja qual for a cor por baixo", () => {
    const { pixels, pintar } = imagem(400, 300, [0, 0, 0, 0]);
    pintar(100, 50, 300, 250, AZUL);
    expect(caixaDoConteudo(pixels, 400, 300)).toEqual({ x: 92, y: 42, largura: 216, altura: 216 });
  });

  it("fundo escuro liso também é margem", () => {
    const { pixels, pintar } = imagem(300, 300, [20, 20, 20, 255]);
    pintar(100, 100, 200, 200, [240, 200, 40, 255]);
    expect(caixaDoConteudo(pixels, 300, 300)).toEqual({ x: 94, y: 94, largura: 112, altura: 112 });
  });

  it("imagem minúscula ou com menos pixels que o anunciado não quebra", () => {
    expect(caixaDoConteudo(new Uint8ClampedArray(0), 0, 0)).toBeNull();
    expect(caixaDoConteudo(new Uint8ClampedArray(16), 400, 300)).toBeNull();
  });
});
