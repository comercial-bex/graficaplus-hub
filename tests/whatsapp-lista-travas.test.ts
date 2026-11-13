import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Travas da lista de conversas (dono: MOLDURA, onda 1 da caixa do WhatsApp,
 * 12/11/2026). Vieram SEM MUDAR de tests/title-vira-texto-visivel.test.ts,
 * para a MOLDURA mexer só no próprio teste. Trava que muda de propósito é
 * trocada aqui pela garantia nova, nunca apagada.
 */

const LISTA = readFileSync("src/components/whatsapp/lista-de-conversas.tsx", "utf8");

describe("a lista de conversas (travas que vieram de outros testes, 12/11/2026)", () => {
  // De tests/title-vira-texto-visivel.test.ts (20/10/2026): quantos esperam
  // resposta em cada fila só aparecia no title, com o mouse parado.
  it("lista: cada fila diz quantos esperam resposta, à vista", () => {
    expect(LISTA).toContain('<span className="sr-only"> esperando resposta</span>');
    expect(LISTA).toContain("{n && n.aguardando > 0 && (");
  });
});
