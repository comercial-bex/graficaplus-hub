import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * O trilho do menu mostra o nome de cada área o tempo todo (01/11/2026). Antes o nome só
 * aparecia no celular e na dica ao passar o mouse; no computador sobrava um ícone sem texto.
 * O dono, que enxerga mal, elogiou o menu do Holdprint justamente por ter o nome escrito.
 */

const MENU = readFileSync("src/components/menu/menu-lateral.tsx", "utf8");
const trilho = MENU.slice(MENU.indexOf('aria-label="Módulos"'), MENU.indexOf("aria-label={dicasDoMenu.busca}") > 0 ? MENU.indexOf("aria-label={dicasDoMenu.busca}") : MENU.indexOf('aria-label="Meu perfil"'));

describe("trilho do menu", () => {
  it("o nome da área aparece também no computador", () => {
    expect(trilho).toContain("{m.curto}");
    const rotulo = trilho.match(/<span className="([^"]*)">\s*\{m\.curto\}/);
    expect(rotulo, "não achei o rótulo do módulo no trilho").not.toBeNull();
    expect(rotulo![1]).not.toContain("md:hidden");
    expect(rotulo![1]).toContain("truncate");
  });

  it("o botão cresce para caber ícone e nome, sem passar da largura do trilho", () => {
    expect(trilho).toContain("md:h-14 md:w-14");
    expect(trilho).not.toContain("md:h-11 md:w-11");
    // o trilho tem w-16 (64 px) e o botão w-14 (56 px): sobra folga dos dois lados
    expect(MENU).toContain("w-16 shrink-0");
  });

  it("a dica ao passar o mouse continua, com o nome por extenso", () => {
    expect(trilho).toContain("<DicaDoTrilho key={m.id} texto={m.label}>");
  });
});

describe("subgrupos do painel que recolhem", () => {
  it("o título continua sendo o <h3 data-subgrupo> de sempre, e a lista só se esconde (os itens seguem na página)", () => {
    expect(MENU).toMatch(/<h3\s+data-subgrupo=""/);
    expect(MENU).toContain("<ul hidden={recolhida}");
  });

  it("o subgrupo da tela em que a pessoa está nunca fecha, e por isso nem tem o botão", () => {
    expect(MENU).toContain("const temTelaAtiva = sec.entradas.some(ativa);");
    expect(MENU).toContain("const recolhida = !!sec.label && !temTelaAtiva && !abertos.includes(chave);");
    expect(MENU).toContain("{!temTelaAtiva && (");
  });

  it("o botão diz o que faz e se está aberto, para leitor de tela e teclado", () => {
    expect(MENU).toContain("aria-expanded={!recolhida}");
    expect(MENU).toContain('aria-label={`${recolhida ? "Abrir" : "Recolher"} ${sec.label}`}');
  });

  it("como no Holdprint (02/11/2026): o grupo começa fechado e abre no toque; lembra neste aparelho o que foi aberto, sem divergir do servidor", () => {
    expect(MENU).toContain('const CHAVE_ABERTOS = "bexprint:menu:subgrupos-abertos";');
    expect(MENU).toContain("useState<string[]>([])");
    expect(MENU).toContain("setAbertos(lerAbertos());");
    // a linha inteira do grupo abre: o botão cobre a linha, e o título segue no <h3>
    expect(MENU).toContain('className="absolute inset-0 flex w-full items-center justify-end rounded-lg pr-3');
    // os itens abertos ficam recuados com a guia à esquerda
    expect(MENU).toContain('sec.label && "ml-4 border-l border-sidebar-border pl-2"');
    // armazenamento bloqueado (navegação privada) não derruba o menu
    expect(MENU.slice(MENU.indexOf("function lerAbertos"), MENU.indexOf("function lembrarModulo"))).toContain("catch");
  });
});
