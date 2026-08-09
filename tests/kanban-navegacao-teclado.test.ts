import { test, expect } from "vitest";
import {
  coordenadaNaColuna,
  indiceColunaAtual,
  ordenarColunas,
  proximaColuna,
  type ColunaAlvo,
} from "../src/domain/kanban/navegacao-teclado";

// Quadro como ele aparece: colunas de 320px lado a lado (w-80 no Tailwind).
const coluna = (id: string, left: number): ColunaAlvo => ({
  id,
  left,
  right: left + 320,
  width: 320,
  top: 300,
});

const quadro = [
  coluna("entrada", 0),
  coluna("aguardando_briefing", 320),
  coluna("briefing_ok", 640),
  coluna("design", 960),
];

const LARGURA_CARTAO = 288; // w-72

test("seta direita salta para a coluna seguinte, não 25px", () => {
  // cartão centrado em "entrada"
  const destino = proximaColuna(quadro, 160, 1);
  expect(destino?.id).toBe("aguardando_briefing");
  // o salto é de uma coluna inteira
  expect(destino!.left - quadro[0].left).toBe(320);
});

test("seta esquerda volta para a coluna anterior", () => {
  expect(proximaColuna(quadro, 800, -1)?.id).toBe("aguardando_briefing");
});

test("nas pontas não há destino — o cartão não escapa do quadro", () => {
  expect(proximaColuna(quadro, 160, -1)).toBeNull();
  expect(proximaColuna(quadro, 1120, 1)).toBeNull();
});

test("colunas fora de ordem no DOM são ordenadas pela posição na tela", () => {
  const desordenado = [quadro[2], quadro[0], quadro[3], quadro[1]];
  expect(ordenarColunas(desordenado).map((c) => c.id)).toEqual([
    "entrada",
    "aguardando_briefing",
    "briefing_ok",
    "design",
  ]);
  // e o salto continua correto mesmo com a lista embaralhada
  expect(proximaColuna(desordenado, 160, 1)?.id).toBe("aguardando_briefing");
});

test("cartão entre duas colunas usa a de centro mais próximo", () => {
  // 330 cai dentro de "aguardando_briefing" (320..640)
  expect(indiceColunaAtual(quadro, 330)).toBe(1);
  // à esquerda de tudo: cai na primeira
  expect(indiceColunaAtual(quadro, -500)).toBe(0);
  // à direita de tudo: cai na última
  expect(indiceColunaAtual(quadro, 5000)).toBe(3);
});

test("borda exata da coluna conta como dentro dela", () => {
  expect(indiceColunaAtual(quadro, 320)).toBe(0); // right da primeira
  expect(indiceColunaAtual(quadro, 321)).toBe(1);
});

test("coordenada devolvida centraliza o cartão na coluna de destino", () => {
  const { x, y } = coordenadaNaColuna(quadro[1], LARGURA_CARTAO);
  // centro da coluna 1 = 320 + 160 = 480 ; menos metade do cartão
  expect(x).toBe(480 - LARGURA_CARTAO / 2);
  // o centro do cartão cai dentro da coluna, que é o que decide a colisão
  expect(x + LARGURA_CARTAO / 2).toBeGreaterThanOrEqual(quadro[1].left);
  expect(x + LARGURA_CARTAO / 2).toBeLessThanOrEqual(quadro[1].right);
  // afastado do cabeçalho da coluna
  expect(y).toBe(quadro[1].top + 8);
});

test("saltos sucessivos atravessam o quadro coluna por coluna", () => {
  let centro = 160; // começa em "entrada"
  const visitadas: string[] = [];
  for (let i = 0; i < 3; i++) {
    const destino = proximaColuna(quadro, centro, 1);
    if (!destino) break;
    visitadas.push(destino.id);
    // simula o cartão já reposicionado no destino
    centro = coordenadaNaColuna(destino, LARGURA_CARTAO).x + LARGURA_CARTAO / 2;
  }
  expect(visitadas).toEqual(["aguardando_briefing", "briefing_ok", "design"]);
});

test("quadro sem colunas visíveis não devolve destino", () => {
  expect(proximaColuna([], 100, 1)).toBeNull();
  expect(indiceColunaAtual([], 100)).toBe(-1);
});

test("uma única coluna não tem para onde saltar", () => {
  const so = [coluna("entrada", 0)];
  expect(proximaColuna(so, 160, 1)).toBeNull();
  expect(proximaColuna(so, 160, -1)).toBeNull();
});
