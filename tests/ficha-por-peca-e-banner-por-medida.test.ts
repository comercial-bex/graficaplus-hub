import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Ficha "por peça" e o banner do cliente final por medida (22/10/2026). Pedido
 * do dono: "banner com o cliente final não tá dando pra colocar as medidas". O
 * banner do cliente final era por UNIDADE (R$ 110): a equipe digitava o banner
 * como item livre — sem ficha, custo zero, sem baixa. O terceirizado não tinha
 * o bastão na ficha. E a baixa da OS sugeria "peças × ficha", sem a área: a OS
 * #164 tinha 1,955 m² de lona reservados e baixou 1,0.
 */

const { dados, consulta } = vi.hoisted(() => {
  const dados: Record<string, unknown> = {};
  const erros: Record<string, unknown> = {};
  const consulta = (nome: string) => {
    const q: Record<string, unknown> = {};
    const resposta = () => ({ data: dados[nome] ?? null, error: erros[nome] ?? null });
    q.select = () => q;
    q.eq = () => q;
    q.in = () => q;
    q.single = async () => resposta();
    q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(resposta()).then(ok, falha);
    return q;
  };
  return { dados, erros, consulta };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (n: string) => consulta(n) } }));
vi.mock("@/lib/supabase-financial-views", () => ({ fromFinancialView: (n: string) => consulta(n) }));

import { calcularConsumoPrevisto } from "../src/lib/estoque-baixa";

const LONA = "9df570b3-b465-43fe-a446-28eb6e971b1e";
const KIT = "a42a7912-ba66-4ed2-a917-f179b43db6f1";

describe("a sugestão da baixa é a previsão da OS (a mesma que reservou)", () => {
  beforeEach(() => {
    for (const k of Object.keys(dados)) delete dados[k];
    dados.ordens_servico = { id: "os", numero: 164, estoque_baixado: false };
    dados.itens_os = [{ id: "item", descricao: "Banner com bastão e corda (Terceirizado)" }];
    dados.materiais = [
      { id: LONA, nome: "Lona 280g brilho", estoque: 4, unidade: "m²" },
      { id: KIT, nome: "Bastão + corda para banner", estoque: 18, unidade: "un" },
    ];
  });

  it("banner 1,15 × 1,70 m: 1,955 m² de lona e 1 kit — não '1 peça × ficha'", async () => {
    dados.os_materiais_previstos = [
      { material_id: LONA, os_item_id: "item", quantidade: "1.9550" },
      { material_id: KIT, os_item_id: "item", quantidade: "1.0000" },
    ];
    const plano = await calcularConsumoPrevisto("os");
    expect(plano.ok).toBe(true);
    const porNome = Object.fromEntries(plano.linhas.map((l) => [l.material_nome, l.quantidade_prevista]));
    expect(porNome["Lona 280g brilho"]).toBe(1.955);
    expect(porNome["Bastão + corda para banner"]).toBe(1);
    expect(plano.linhas[1].origens).toEqual([{ produto_nome: "Banner com bastão e corda (Terceirizado)", quantidade: 1.955 }]);
  });

  it("dois itens com o mesmo material somam", async () => {
    dados.itens_os = [{ id: "a", descricao: "Banner A" }, { id: "b", descricao: "Banner B" }];
    dados.os_materiais_previstos = [
      { material_id: LONA, os_item_id: "a", quantidade: 2 },
      { material_id: LONA, os_item_id: "b", quantidade: 0.96 },
    ];
    const plano = await calcularConsumoPrevisto("os");
    expect(plano.linhas).toHaveLength(1);
    expect(plano.linhas[0].quantidade_prevista).toBe(2.96);
    expect(plano.linhas[0].origens.map((o) => o.produto_nome)).toEqual(["Banner A", "Banner B"]);
  });

  it("sem previsão, diz o porquê em vez de sugerir zero", async () => {
    dados.os_materiais_previstos = [];
    const plano = await calcularConsumoPrevisto("os");
    expect(plano.ok).toBe(false);
    expect(plano.motivo).toContain("não tem material previsto");
  });

  it("OS já baixada não oferece outra baixa", async () => {
    dados.ordens_servico = { id: "os", numero: 164, estoque_baixado: true };
    const plano = await calcularConsumoPrevisto("os");
    expect(plano).toMatchObject({ ok: false, ja_baixada: true });
  });

  it("não refaz a conta pela ficha (era ali que a área sumia)", () => {
    const fonte = readFileSync("src/lib/estoque-baixa.ts", "utf8");
    expect(fonte).toContain('.from("os_materiais_previstos")');
    expect(fonte).not.toContain("quantidade_por_unidade");
  });
});

const SQL = readFileSync("supabase/migrations/20261022120000_ficha_por_peca_e_banner_por_medida.sql", "utf8");

describe("a ficha conta por peça quando a linha diz", () => {
  it("coluna nova, falsa por padrão (nada muda nas fichas que já existem)", () => {
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS por_peca boolean NOT NULL DEFAULT false;");
  });

  it("a previsão da OS usa as peças na linha por peça, e a base de sempre nas outras", () => {
    expect(SQL).toContain(
      "CASE WHEN pm.por_peca THEN greatest(coalesce(i.quantidade, 1), 1) ELSE public.base_de_consumo_item(i.area_cobrada, i.quantidade) END",
    );
    expect(SQL).toContain("IF n <> 1 THEN");
  });

  it("orçamento e calculadora usam a mesma regra", () => {
    const check = readFileSync("src/components/orcamento-material-check.tsx", "utf8");
    expect(check).toContain("const base = m.porPeca ? Math.max(pecas, 1) : baseDeConsumo;");
    expect(readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8")).toContain(
      "pecas={quantidadeForm}",
    );
    const calc = readFileSync("src/components/orcamento/calculadora-custo.tsx", "utf8");
    expect(calc).toContain("(f.por_peca ? Math.max(quantidade, 1) : baseConsumo)");
  });

  it("o editor da ficha mostra 'por m² / por peça' só em produto por m², e grava a escolha", () => {
    const ed = readFileSync("src/components/produto-materiais-editor.tsx", "utf8");
    expect(ed).toContain("const porArea = ehUnidadeDeArea(produtoUnidade);");
    expect(ed).toContain("por_peca: porArea && porPecaNova,");
    expect(ed).toContain(".update({ por_peca: porPeca })");
    expect(ed).toContain("{porArea && <TableHead");
  });
});

describe("o banner", () => {
  it("cliente final por m², mínimo 1 m² (decisão do dono); preço/m² continua R$ 110", () => {
    expect(SQL).toContain("SET unidade = 'm2', area_minima_cobrada = 1");
    expect(SQL).not.toMatch(/preco_base\s*=/);
  });

  it("o kit de bastão e corda é um por banner — nos dois banners", () => {
    expect(SQL).toContain("SET por_peca = true");
    expect(SQL).toContain("INSERT INTO public.produto_materiais (produto_id, material_id, quantidade_por_unidade, por_peca)");
    expect(SQL).toContain("WHERE NOT EXISTS (");
  });

  it("nada é apagado", () => {
    expect(SQL).not.toMatch(/\bDELETE\b/i);
  });
});

describe("item livre com nome de produto do catálogo", () => {
  const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
  it("avisa e oferece o produto, sem trocar sozinho", () => {
    expect(TELA).toContain("!form.produto_id && form.descricao.trim()");
    expect(TELA).toContain("onClick={() => aplicarProduto(produtoComOMesmoNome)}");
    expect(TELA).toContain("sem custo e sem baixa de estoque.");
  });
});
