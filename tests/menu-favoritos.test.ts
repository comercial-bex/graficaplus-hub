import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Favoritos no menu (01/11/2026): o dono pediu os favoritos visíveis, como no Holdprint. Cada tela
 * do menu ganha uma estrela; as marcadas aparecem no alto do painel de qualquer módulo.
 */

const MENU = readFileSync("src/components/menu/menu-lateral.tsx", "utf8");

describe("favoritos do menu", () => {
  it("cada tela tem uma estrela que diz o que faz e se está marcada, menos o link do Início", () => {
    expect(MENU).toContain("data-favorito=\"\"");
    expect(MENU).toContain("aria-pressed={favoritos.includes(e.url)}");
    expect(MENU).toContain('"Tirar dos favoritos" : "Pôr nos favoritos"');
    expect(MENU).toContain('{e.marca !== "topo" && (');
  });

  it("a estrela fica ao lado do item, não dentro do link (botão dentro de link não vale)", () => {
    const li = MENU.slice(MENU.indexOf('<li key={e.url} className="relative">'), MENU.indexOf("</li>", MENU.indexOf("data-favorito")));
    expect(li.indexOf("</Link>")).toBeGreaterThan(-1);
    expect(li.indexOf("</Link>")).toBeLessThan(li.indexOf("data-favorito"));
    expect(MENU).toContain("pr-11"); // o texto e a contagem não passam por cima da estrela
  });

  it("as marcadas aparecem no alto do painel de qualquer módulo, com o que a pessoa ainda pode ver", () => {
    expect(MENU).toContain("const todosOsItens = areas.flatMap((a) => a.subgrupos.flatMap((s) => s.itens));");
    expect(MENU).toContain('label: "Favoritos"');
    expect(MENU).toMatch(/\.\.\.secoesDoModulo,\s*\]/);
    // a árvore já vem filtrada por permissão: tela sem acesso não vira favorita fantasma
    // 02/11/2026: tela que virou aba de um hub continua valendo como favorito e abre a aba.
    expect(MENU).toContain("const dono = todosOsItens.find((i) => i.telas.some((t) => t.url === url));");
    expect(MENU).toContain("url: aba.url, link: aba.url, title: aba.title");
  });

  it("o contador 'N itens' do módulo não conta os favoritos de novo", () => {
    expect(MENU).toContain("const nEntradas = secoesDoModulo.reduce(");
  });

  it("a seção só aparece depois de ler o que a pessoa marcou, para o HTML não divergir do servidor", () => {
    expect(MENU).toContain("const [favoritos, setFavoritos] = useState<string[]>([]);");
    expect(MENU).toContain("const [favoritosLidos, setFavoritosLidos] = useState(false);");
    expect(MENU).toContain("const secoes: Secao[] = favoritosLidos");
  });

  it("sem favorito ainda, a seção ensina o que fazer; recolhida, não repete a dica", () => {
    expect(MENU).toContain("Toque na estrela de uma tela e ela aparece aqui");
    expect(MENU).toContain("sec.vazio && sec.entradas.length === 0 && !recolhida");
  });

  it("guarda neste aparelho, por pessoa, e armazenamento bloqueado não derruba o menu", () => {
    expect(MENU).toContain("`bexprint:menu:favoritos:${email ?? \"sem-email\"}`");
    const leitura = MENU.slice(MENU.indexOf("function lerFavoritos"), MENU.indexOf("function lembrarFavoritos"));
    expect(leitura).toContain("catch");
    expect(leitura).toContain("filter((x): x is string => typeof x === \"string\")");
  });
});
