import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { SectionHeader } from "../src/components/bex/SectionHeader";
import { percentual } from "../src/lib/percentual";

/**
 * Revisão ao vivo no sistema publicado (21/10/2026, logado como o dono, só
 * olhando — nada salvo): o que estava certo foi conferido (custo/m² e margem
 * da peça no #69, produto em abas, cartões do quadro, "Conversar no WhatsApp"
 * de ponta a ponta na YRLEN); estes cinco pontos apareceram e foram corrigidos.
 */

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("1. percentual com vírgula", () => {
  it("escreve como o resto da tela: vírgula, casas fixas", () => {
    const sp = (t: string) => t.replace(/ /g, " ");
    expect(sp(percentual(68.8))).toBe("68,8%");
    expect(sp(percentual(-39.84))).toBe("-39,8%");
    expect(sp(percentual(50))).toBe("50,0%");
    expect(sp(percentual(12.345, 2))).toBe("12,35%");
    expect(sp(percentual(Number.NaN))).toBe("0,0%");
  });

  it("nenhuma tela volta a escrever percentual com toFixed (ponto decimal)", () => {
    const achados: string[] = [];
    for (const f of arquivos("src")) {
      readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        if (/toFixed\((1|2)\)\}%/.test(l)) achados.push(`${f}:${i + 1}`);
      });
    }
    expect(achados, "use percentual() de src/lib/percentual.ts").toEqual([]);
  });

  it("nem dinheiro com ponto: 'R$ 20.10' aparecia no orçamento 3D, na ficha do cliente e no topo da OS", () => {
    const achados: string[] = [];
    for (const f of arquivos("src")) {
      readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        if (/R\$ \$\{[^`]*toFixed\(2\)/.test(l)) achados.push(`${f}:${i + 1}`);
      });
    }
    expect(achados, "use formatBRL() de src/lib/produtos-catalogo.ts").toEqual([]);
  });
});

describe("2. o quadro não diz 'vazio' enquanto carrega, nem quando falha", () => {
  const K = readFileSync("src/routes/_authenticated/kanban.tsx", "utf8");
  it("o contador diz 'carregando…', a coluna mostra o esqueleto, e a falha tem aviso com tentar de novo", () => {
    expect(K).toContain('label={carregandoOs ? "carregando…" : `${filtered.length}/${os.length} OS`}');
    expect(K).toContain("{itens.length === 0 && carregando && (");
    expect(K).toContain("{itens.length === 0 && !carregando && (");
    expect(K).toContain('titulo="Não foi possível carregar as OS do quadro"');
    expect(K).toContain("onTentarDeNovo={() => void recarregarOs()}");
  });
});

describe("3. item por área conta peças", () => {
  it("a tabela do orçamento escreve '25 peças', não '25 m2'", () => {
    const O = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
    expect(O).toContain('{temDimensoes(i) ? (Number(i.quantidade) === 1 ? "peça" : "peças") : i.unidade}');
  });
});

describe("4. o nome do produto abre a ficha; o ⋮ tem nome", () => {
  const P = readFileSync("src/routes/_authenticated/produtos.tsx", "utf8");
  it("nome é botão (tabela e cartão) e o menu de ações se apresenta", () => {
    expect(P.match(/onClick=\{\(\) => abrirEdicao\(p\)\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(P).toContain("aria-label={`Ações de ${produto.nome}`}");
  });
});

describe("5. o cabeçalho da tela não espreme o título", () => {
  it("título guarda 16rem; as ações descem quando falta lugar", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(SectionHeader, { title: "WhatsApp", actions: createElement("button", null, "Monitor") }),
      ),
    );
    expect(html).toContain("flex flex-wrap items-center justify-between");
    expect(html).toContain("min-w-0 flex-1 basis-64");
    expect(html).not.toContain("md:grid-cols-[minmax(0,1fr)_auto]");
  });
});
