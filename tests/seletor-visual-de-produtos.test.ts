import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  alternarFavorito,
  chaveDosFavoritosDeProduto,
  gravarFavoritosDeProduto,
  lerFavoritosDeProduto,
  LIMITE_DE_FAVORITOS,
  normalizarFavoritos,
} from "../src/domain/orcamentos/favoritos-de-produto";
import {
  familiasDoGrupo,
  filtrarPorFamilia,
  mostrarFiltroDeFamilia,
} from "../src/domain/orcamentos/familias-na-escolha";

/**
 * Seletor visual de produtos no orçamento (01/11/2026), no desenho do Holdprint:
 * tipo com ilustração, família como filtro, foto grande no cartão e estrela de
 * favorito. O dono pediu "ícone visual" para quem está aprendendo.
 */

const ler = (c: string) => readFileSync(c, "utf8");

function armazemFalso(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    dados,
  };
}

describe("favoritos de produto ficam no aparelho de quem vende", () => {
  it("a chave é por e-mail, em minúsculas, e tem um fallback", () => {
    expect(chaveDosFavoritosDeProduto(" Vendas@BexPrint.com.br ")).toBe(
      "bexprint:orcamento:produtos-favoritos:vendas@bexprint.com.br",
    );
    expect(chaveDosFavoritosDeProduto(null)).toBe("bexprint:orcamento:produtos-favoritos:sem-email");
  });

  it("lê lista limpa e devolve vazio para lixo, JSON quebrado e armazenamento bloqueado", () => {
    const chave = chaveDosFavoritosDeProduto("a@b.c");
    expect(lerFavoritosDeProduto(chave, armazemFalso({ [chave]: '["x","x","y"]' }))).toEqual(["x", "y"]);
    expect(lerFavoritosDeProduto(chave, armazemFalso({ [chave]: "{nao é lista" }))).toEqual([]);
    expect(lerFavoritosDeProduto(chave, armazemFalso({ [chave]: '{"a":1}' }))).toEqual([]);
    expect(lerFavoritosDeProduto(chave, null)).toEqual([]);
    const quebrado = { getItem: () => { throw new Error("bloqueado"); } };
    expect(lerFavoritosDeProduto(chave, quebrado)).toEqual([]);
  });

  it("a estrela entra na frente e sai se já estava; o limite segura a lista", () => {
    expect(alternarFavorito([], "a")).toEqual(["a"]);
    expect(alternarFavorito(["a"], "b")).toEqual(["b", "a"]);
    expect(alternarFavorito(["b", "a"], "a")).toEqual(["b"]);
    const muitos = Array.from({ length: LIMITE_DE_FAVORITOS + 5 }, (_, i) => `p${i}`);
    expect(normalizarFavoritos(muitos)).toHaveLength(LIMITE_DE_FAVORITOS);
    expect(normalizarFavoritos([1, null, "ok", ""])).toEqual(["ok"]);
  });

  it("grava sem estourar quando o armazenamento recusa", () => {
    const chave = chaveDosFavoritosDeProduto("a@b.c");
    const a = armazemFalso();
    gravarFavoritosDeProduto(chave, ["y", "x", "y"], a);
    expect(a.dados.get(chave)).toBe('["y","x"]');
    expect(() => gravarFavoritosDeProduto(chave, ["x"], { setItem: () => { throw new Error("cota"); } })).not.toThrow();
  });
});

describe("família como filtro dentro do tipo", () => {
  const adesivos = [
    ...Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, familia: "Adesivos de carroceria" })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, familia: "Adesivos impressos" })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, familia: "Adesivos perfurados" })),
    { id: "r0", familia: "Adesivos com recorte" },
    { id: "e0", familia: "Adesivos especiais" },
  ];

  it("conta da maior para a menor e desempata pelo nome", () => {
    expect(familiasDoGrupo(adesivos).map((f) => `${f.familia}:${f.quantidade}`)).toEqual([
      "Adesivos de carroceria:7",
      "Adesivos impressos:5",
      "Adesivos perfurados:4",
      "Adesivos com recorte:1",
      "Adesivos especiais:1",
    ]);
  });

  it("só aparece em tipo grande com 2 ou mais famílias", () => {
    expect(mostrarFiltroDeFamilia(adesivos)).toBe(true);
    // Placa e acrílico: 7 produtos, mas o teste de 2 famílias com 7 passa; com 6 não.
    expect(mostrarFiltroDeFamilia(adesivos.slice(0, 6))).toBe(false);
    // 10 brindes, uma família só: não vale o toque a mais.
    expect(mostrarFiltroDeFamilia(Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, familia: "Brindes personalizados" })))).toBe(false);
    // Produto sem família não vira chip.
    expect(familiasDoGrupo([{ id: "x", familia: null }, { id: "y", familia: "  " }])).toEqual([]);
  });

  it("filtra pela família marcada e volta à lista inteira se a família sumiu", () => {
    expect(filtrarPorFamilia(adesivos, "Adesivos perfurados")).toHaveLength(4);
    expect(filtrarPorFamilia(adesivos, null)).toHaveLength(18);
    expect(filtrarPorFamilia(adesivos, "Família que não existe")).toHaveLength(18);
  });
});

describe("a tela da escolha usa o desenho, a família e a estrela", () => {
  const tela = ler("src/components/orcamento/escolha-de-produto.tsx");

  it("os cartões de tipo e o cartão sem foto usam a ilustração, e a foto vai em cima do cartão", () => {
    expect(tela.includes('from "@/components/orcamento/ilustracoes-de-tipo"')).toBe(true);
    expect((tela.match(/<IlustracaoDoTipo /g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(tela.includes('className="aspect-square w-full rounded-lg object-cover"')).toBe(true);
    expect(tela.includes('data-testid="sem-foto"')).toBe(true);
    // A grade de produtos tem 2 colunas no celular e 4 no monitor, como vitrine.
    expect(tela.includes('className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"')).toBe(true);
  });

  it("a família é um filtro com aria-pressed e os favoritos são o primeiro atalho", () => {
    expect(tela.includes('data-testid="filtro-de-familia"')).toBe(true);
    expect(tela.includes("mostrarFiltroDeFamilia(produtosDoGrupo)")).toBe(true);
    expect(tela.includes('titulo: "Favoritos"')).toBe(true);
    expect(tela.includes("nos favoritos`")).toBe(true);
    expect(tela.includes("dos favoritos`")).toBe(true);
    expect(tela.includes("chaveDosFavoritosDeProduto(user?.email)")).toBe(true);
  });

  it("não pinta texto com text-primary nem usa title=", () => {
    expect(/(?<![-\w])text-primary(?![-\w])/.test(tela)).toBe(false);
    expect(/\stitle=/.test(tela)).toBe(false);
    const ilustracoes = ler("src/components/orcamento/ilustracoes-de-tipo.tsx");
    expect(/\stitle=/.test(ilustracoes)).toBe(false);
    expect(ilustracoes.includes('aria-hidden="true"')).toBe(true);
    // Nove tipos, nove desenhos (o `default` cobre "outros").
    for (const chave of ["lona", "adesivo", "placa", "papel", "brinde", "acabamento", "servico", "impressao_3d"]) {
      expect(ilustracoes.includes(`case "${chave}":`), chave).toBe(true);
    }
  });
});

describe("a família chega pela view do catálogo", () => {
  const migracao = ler("supabase/migrations/20261101230000_familia_nas_views_de_produtos.sql");
  const tipos = ler("src/integrations/supabase/types.ts");

  it("as três views voltam com as suas opções e com a família no fim", () => {
    expect(migracao.includes("CREATE OR REPLACE VIEW public.produtos_operacional\nWITH (security_invoker = true)")).toBe(true);
    expect(migracao.includes("CREATE OR REPLACE VIEW public.produtos_comercial\nWITH (security_invoker = false, security_barrier = true)")).toBe(true);
    expect(migracao.includes("CREATE OR REPLACE VIEW public.produtos_financeiro\nWITH (security_invoker = true)")).toBe(true);
    expect((migracao.match(/\n\s+(p\.)?familia\n/g) ?? []).length).toBe(3);
    expect(migracao.includes("REVOKE ALL ON public.produtos_financeiro FROM anon;")).toBe(true);
  });

  it("os tipos gerados conhecem a coluna nas três views", () => {
    for (const view of ["produtos_operacional", "produtos_comercial", "produtos_financeiro"]) {
      const inicio = tipos.indexOf(`      ${view}: {`);
      expect(inicio, view).toBeGreaterThan(0);
      const bloco = tipos.slice(inicio, inicio + 1200);
      expect(bloco.includes("familia: string | null"), view).toBe(true);
    }
  });
});
