import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * O painel do menu em tela baixa (20/10/2026). O dono pediu para analisar e
 * otimizar o menu lateral. Medido no menu REAL, com o perfil de administrador,
 * num notebook com 650 px úteis de altura (1366 × 768 menos a barra do
 * navegador):
 *
 *   cabeçalho (logo, foto, nome, e-mail) ..... 223 px
 *   cartão "Módulo · Vendas · 11 itens" ....... 65 px
 *   rodapé (perfil, reembolsos, instalar, sair) 175 px
 *   ────────────────────────────────────────── 463 px de 650 (71%)
 *   sobram ~190 px para a lista: 3 de 11 itens de Vendas à vista.
 *
 * Com a compactação (só em tela de até 800 px de altura): 321 px de moldura e
 * 329 px de lista — 5 itens à vista. Em monitor alto o desenho que o dono aprovou
 * em 06/10 continua exatamente o mesmo: as regras novas só valem sob a consulta
 * de altura, e as classes de sempre ficam.
 *
 * (Primeira medição saiu errada: a página de teste usou a largura padrão do
 * componente, 16 rem, e não os 20,5 rem do layout real — "22 de 37 rótulos
 * cortados" era artefato. Na largura real nenhum rótulo é cortado.)
 */

const MENU = readFileSync("src/components/menu/menu-lateral.tsx", "utf8");
const BAIXA = "[@media(max-height:800px)]";

describe("o painel do menu compacta em tela baixa e não muda em tela alta", () => {
  it("as classes de sempre continuam: foto de 64 px, logo de 144 px, cabeçalho com respiro", () => {
    expect(MENU).toContain('className="h-auto w-36 max-w-[calc(100%-3rem)] select-none object-contain');
    expect(MENU).toContain("<Avatar className=\"h-16 w-16 ring-[3px]");
    expect(MENU).toContain("px-4 pb-4 pt-4");
    expect(MENU).toContain('<div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-3');
  });

  it("em tela de até 800 px de altura: logo, foto, e-mail, cartão do módulo e rodapé encolhem", () => {
    for (const regra of [
      `${BAIXA}:w-24`, // logo
      `${BAIXA}:h-10`, // foto (e ícone do módulo: h-8)
      `${BAIXA}:hidden`, // e-mail: o nome fica
      `${BAIXA}:py-1.5`, // cartão do módulo
      `${BAIXA}:p-1.5`, // rodapé
      `${BAIXA}:gap-1`,
      `${BAIXA}:pt-2`,
    ]) {
      expect(MENU, regra).toContain(regra);
    }
    expect(MENU).toContain(`md:${BAIXA}:h-8`); // linhas do rodapé
  });

  it("nada some em tela baixa que a pessoa precise: o nome fica, os itens do menu não encolhem", () => {
    // O e-mail some (o nome e a foto identificam); a linha de cada item da lista não muda.
    const email = MENU.slice(MENU.indexOf("pessoa.email && ("), MENU.indexOf("pessoa.email && (") + 400);
    expect(email).toContain(`${BAIXA}:hidden`);
    const itemDaLista = MENU.slice(MENU.indexOf('className="group/item flex h-11'), MENU.indexOf('className="group/item flex h-11') + 120);
    expect(itemDaLista).not.toContain(BAIXA);
  });

  it("os rótulos do rodapé seguem inteiros: a largura real do painel é 20,5 rem (264 px), não a padrão", () => {
    expect(MENU).toContain('export const LARGURA_DO_MENU = "20.5rem";');
    expect(MENU).toContain("<span>Meus reembolsos</span>");
    expect(MENU).toContain("<span>Instalar no celular</span>");
  });
});
