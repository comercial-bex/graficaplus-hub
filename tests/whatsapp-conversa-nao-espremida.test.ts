import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A conversa do WhatsApp não fica espremida, em nenhuma largura.
 *
 * Até 11/11/2026 a grade da caixa tinha altura fixa a partir de 1024 px e o
 * painel do contato ganhava `lg:col-span-2`: entre 1024 e 1279 px ele descia
 * para uma segunda linha DENTRO da mesma altura, e a área das mensagens ficava
 * com uma faixa de uns 60 px (print do dono, janela de uns 1000 px úteis).
 *
 * MUDOU DE PROPÓSITO na onda 1 (12/11/2026, MOLDURA): o ponto de quebra deixou
 * de olhar a JANELA (`xl:`) e passou a olhar a LARGURA ÚTIL da área (consulta
 * de contêiner `@min-[1280px]/caixa:`), e o painel virou a gaveta de dados do
 * contato (por cima abaixo de 1280 px). A trava velha ("o painel só vira coluna
 * a partir de xl", lendo as classes do <PainelDaConversa>) não existe mais.
 *
 * A garantia de fundo (a conversa nunca é espremida e o painel nunca ocupa uma
 * segunda linha) está aqui na forma nova e, com a conta de larguras, em
 * tests/whatsapp-moldura.test.ts.
 */

const ROTA = readFileSync("src/routes/_authenticated/whatsapp.tsx", "utf8");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("a conversa ocupa a altura toda", () => {
  it("o painel dos dados nunca ocupa uma segunda linha, e só é coluna a partir de 1280 px úteis", () => {
    const rota = semComentarios(ROTA);
    expect(rota).not.toMatch(/col-span-2/);
    expect(rota).toContain("grid-rows-[minmax(0,1fr)]");
    // A terceira coluna só existe na consulta de 1280 px do contêiner.
    expect(rota).toContain("@min-[1280px]/caixa:grid-cols-[360px_minmax(0,1fr)_360px]");
    const tresColunas = [...rota.matchAll(/(\S*)grid-cols-\[[^\]\s]*_minmax\(0,1fr\)_\d+px\]/g)];
    expect(tresColunas.length).toBeGreaterThan(0);
    for (const m of tresColunas) expect(m[1].replace(/^"/, "")).toBe("@min-[1280px]/caixa:");
  });

  it("abaixo de 1280 px o painel é a gaveta por cima (GavetaDoContato), não uma coluna", () => {
    const rota = semComentarios(ROTA);
    expect(rota).toContain("<GavetaDoContato");
    expect(rota).not.toContain("<PainelDaConversa");
  });
});
