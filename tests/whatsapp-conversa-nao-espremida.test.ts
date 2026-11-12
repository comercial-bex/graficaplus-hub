import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A conversa do WhatsApp não fica espremida entre 1024 e 1279 px.
 *
 * Até 11/11/2026 a grade da caixa tinha altura fixa a partir de 1024 px e o
 * painel do contato ganhava `lg:col-span-2`: entre 1024 e 1279 px ele descia
 * para uma segunda linha DENTRO da mesma altura, e a área das mensagens ficava
 * com uma faixa de uns 60 px (print do dono, janela de uns 1000 px úteis). Nessa
 * faixa também não havia como abrir o painel: o botão "Ações" sumia a partir de
 * 1024 px e o de recolher só aparecia a partir de 1280 px.
 *
 * A regra agora: o painel só vira coluna a partir de `xl`; abaixo disso ele
 * abre na gaveta "Ações", e as duas coisas usam o MESMO ponto de quebra.
 */

const ROTA = readFileSync("src/routes/_authenticated/whatsapp.tsx", "utf8");
const CONVERSA = readFileSync("src/components/whatsapp/conversa-aberta.tsx", "utf8");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("a conversa ocupa a altura toda", () => {
  it("o painel lateral só vira coluna a partir de xl e nunca ocupa uma segunda linha", () => {
    const rota = semComentarios(ROTA);
    const painel = /<PainelDaConversa\s+className="([^"]+)"/.exec(rota);
    expect(painel, "o painel lateral da rota").not.toBeNull();
    const classes = painel![1].split(/\s+/);
    expect(classes).toContain("hidden");
    expect(classes).toContain("xl:flex");
    expect(classes.filter((c) => /^(sm|md|lg):(flex|block|grid)$/.test(c))).toEqual([]);
    expect(rota).not.toMatch(/col-span-2/);
  });

  it("a gaveta Ações aparece em toda largura em que o painel não é coluna", () => {
    const conversa = semComentarios(CONVERSA);
    const gatilho = /<SheetTrigger asChild>\s*<Button[^>]*className="([^"]+)"/.exec(conversa);
    expect(gatilho, "o botão da gaveta").not.toBeNull();
    expect(gatilho![1].split(/\s+/)).toContain("xl:hidden");
    expect(gatilho![1]).not.toMatch(/\blg:hidden\b/);
  });
});
