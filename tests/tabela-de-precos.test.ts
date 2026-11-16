import { describe, expect, it } from "vitest";
import { lucroPorUnidade, margemSobreVenda, posicaoNoMercado, precoDoParceiro } from "../src/domain/precos/tabela-de-precos";

describe("tabela de preços", () => {
  it("preço do parceiro: cadastro do produto ganha do desconto do nível", () => {
    expect(precoDoParceiro({ precoParceiro: 35, precoBase: 70, descontoDoNivelPct: 15 })).toEqual({ valor: 35, origem: "cadastro" });
    expect(precoDoParceiro({ precoParceiro: null, precoBase: 70, descontoDoNivelPct: 15 })).toEqual({ valor: 59.5, origem: "nivel" });
    expect(precoDoParceiro({ precoParceiro: null, precoBase: null, descontoDoNivelPct: 15 })).toBeNull();
  });
  it("lucro e margem são sobre a venda", () => {
    expect(lucroPorUnidade(70, 40)).toBe(30);
    expect(margemSobreVenda(70, 40)).toBe(42.9);
    expect(margemSobreVenda(0, 10)).toBeNull();
    expect(margemSobreVenda(null, 10)).toBeNull();
    expect(margemSobreVenda(35, 40)).toBe(-14.3);
  });
  it("posição contra concorrentes: menor e média, ignora preço inválido", () => {
    const p = posicaoNoMercado(70, [60, 80, 0, NaN]);
    expect(p).toEqual({ menor: 60, media: 70, contraOMenorPct: 16.7, contraAMediaPct: 0 });
    expect(posicaoNoMercado(70, [])).toBeNull();
  });
});

import { readFileSync } from "node:fs";
describe("concorrente por tipo de preço", () => {
  const TELA = ["src/routes/_authenticated/tabela-de-precos.tsx", "src/components/precos/ficha-do-produto.tsx", "src/components/precos/cartao-do-produto.tsx"]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  it("compara terceirizado deles com parceiro nosso, e final com final", () => {
    expect(TELA).toContain('c.tipo_preco === "parceiro"');
    expect(TELA).toContain("parceiro?.valor ?? null");
    expect(TELA).toContain('c.tipo_preco === "final"');
  });
});

import { sugestoesDePreco } from "../src/domain/precos/tabela-de-precos";
describe("sugestões de preço", () => {
  it("bater = concorrente − R$ 1,50, e avisa quando a margem fica abaixo do mínimo", () => {
    const s = sugestoesDePreco({ custo: 22, margemMinimaPct: 40, menorConcorrente: 30 });
    const bater = s.find((x) => x.chave === "bater")!;
    expect(bater.preco).toBe(28.5);
    expect(bater.margem).toBe(22.8);
    expect(bater.abaixoDoMinimo).toBe(true);
    expect(s.find((x) => x.chave === "piso")!.preco).toBe(36.67);
    expect(s.find((x) => x.chave === "igualar")!.preco).toBe(30);
  });
  it("margem acima do mínimo: sem alerta", () => {
    const s = sugestoesDePreco({ custo: 26, margemMinimaPct: 40, menorConcorrente: 45 });
    expect(s.find((x) => x.chave === "bater")!.abaixoDoMinimo).toBe(false);
  });
  it("sem concorrente só sobra o piso; sem custo nem mínimo, nada", () => {
    expect(sugestoesDePreco({ custo: 10, margemMinimaPct: 50, menorConcorrente: null }).map((x) => x.chave)).toEqual(["piso"]);
    expect(sugestoesDePreco({ custo: null, margemMinimaPct: null, menorConcorrente: null })).toEqual([]);
  });
});

describe("preço fixo de parceiro vale no painel", () => {
  const M = readFileSync("supabase/migrations/20261024100000_preco_fixo_de_parceiro_vale.sql", "utf8");
  it("a função do painel usa produtos.preco_parceiro antes do desconto do nível", () => {
    expect(M).toContain("COALESCE(b.preco_fixo, ");
    expect(M).toContain("p.preco_parceiro AS preco_fixo");
  });
});

describe("visual da tabela de preços e ações por linha (16/11/2026)", () => {
  const TELA = readFileSync("src/routes/_authenticated/tabela-de-precos.tsx", "utf8");
  const LINHA = readFileSync("src/components/ui/table.tsx", "utf8");
  const ABAS = readFileSync("src/components/menu/abas-da-tela.tsx", "utf8");
  const compacta = TELA.slice(TELA.indexOf("function TabelaCompacta("));

  it("a linha sob o mouse fica cinza, não na cor de destaque (#ff0055 no tema escuro)", () => {
    expect(LINHA).toContain("hover:bg-muted/60");
    expect(LINHA).not.toMatch(/hover:bg-accent|data-\[state=selected\]:bg-accent/);
  });

  it("no computador as abas quebram linha; a barra compacta segue numa linha só", () => {
    expect(ABAS).toContain('!compacta && "md:w-auto md:flex-wrap"');
  });

  it("a régua some abaixo de tela larga e o nome do produto não se espreme", () => {
    expect(compacta).toContain('<TableHead className="min-w-56">Produto</TableHead>');
    expect(compacta).toContain('className="hidden min-w-52 xl:table-cell">Régua');
    expect(compacta).toContain('<TableCell className="hidden xl:table-cell"><BarraDeComparacao');
  });

  it("Propor preço e Editar produto levam às telas que já existem, sem gravar preço daqui", () => {
    expect(compacta).toContain('to="/precos" search={{ busca: l.produto.nome }}');
    expect(compacta).toContain('to="/produtos/$id" params={{ id: l.produto.id }}');
    expect(compacta).toContain('className="h-11 w-11"');
    expect(compacta).toContain("e.stopPropagation()");
    expect(TELA).toContain('editarProduto: podeAbrirRota("/produtos", hasPermission)');
    expect(TELA).toContain('proporPreco: podeAbrirRota("/precos", hasPermission)');
    expect(TELA).not.toMatch(/\.from\("produtos"\)\s*\.update|preco_proposta_criar|\.rpc\(/);
  });
});
