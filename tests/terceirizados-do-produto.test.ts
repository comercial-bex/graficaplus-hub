import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  custoDosTerceirizados,
  pendenciaDoTerceirizado,
  rotuloDaBase,
} from "@/domain/orcamentos/terceirizados";

/** Fase 3 do plano de 02/11/2026: terceirizados do produto entram no custo do item. */

const LINHAS = [
  { id: "a", descricao: "Corte a laser fora", fornecedor: { nome: "Laser & Cia" }, valor: "12.5", base: "peca" },
  { id: "b", descricao: "Laminação terceirizada", fornecedor: null, valor: 20, base: "m2" },
  { id: "c", descricao: "Frete do fornecedor", fornecedor: null, valor: 30, base: "pedido" },
  { id: "d", descricao: "Sem valor", fornecedor: null, valor: 0, base: "peca" },
];

describe("custo dos terceirizados", () => {
  it("por peça vale o valor; por m² multiplica pela área; por pedido divide entre as peças", () => {
    const r = custoDosTerceirizados(LINHAS, { largura: 2, altura: 1, quantidade: 3 });
    expect(r.linhas.map((l) => [l.descricao, l.porPeca])).toEqual([
      ["Corte a laser fora", 12.5],
      ["Laminação terceirizada", 40],
      ["Frete do fornecedor", 10],
    ]);
    expect(r.total).toBe(62.5);
    expect(r.linhas[0].fornecedor).toBe("Laser & Cia");
  });

  it("sem medida, o por m² dá zero e o por pedido vale o valor inteiro numa peça só", () => {
    const r = custoDosTerceirizados(LINHAS, { largura: null, altura: null, quantidade: 0 });
    expect(r.linhas.map((l) => l.porPeca)).toEqual([12.5, 0, 30]);
  });

  it("base desconhecida conta como por peça; linha sem valor fica de fora", () => {
    const r = custoDosTerceirizados([{ id: "x", descricao: "Outro", valor: 5, base: "lote" }], { largura: 1, altura: 1, quantidade: 1 });
    expect(r.linhas[0].base).toBe("peca");
    expect(r.linhas[0].porPeca).toBe(5);
    expect(rotuloDaBase("m2")).toBe("por m² da peça");
    expect(rotuloDaBase("qualquer")).toBe("por peça");
  });

  it("o cadastro pede descrição, valor e base", () => {
    expect(pendenciaDoTerceirizado({ descricao: " ", valor: "10", base: "peca" })).toBe("Diga o que é terceirizado.");
    expect(pendenciaDoTerceirizado({ descricao: "Corte", valor: "0", base: "peca" })).toMatch(/valor/);
    expect(pendenciaDoTerceirizado({ descricao: "Corte", valor: "12,5", base: "caixa" })).toMatch(/base/);
    expect(pendenciaDoTerceirizado({ descricao: "Corte", valor: "12,5", base: "m2" })).toBeNull();
  });
});

describe("as telas e o banco", () => {
  const pasta = readFileSync("src/routes/_authenticated/produtos_.$id.tsx", "utf8");
  const item = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
  const bloco = readFileSync("src/components/orcamento/material-por-formula.tsx", "utf8");
  const custo = readFileSync("src/components/produtos/custo-da-peca.tsx", "utf8");
  const migracao = readFileSync("supabase/migrations/20261102230000_terceirizados_do_produto.sql", "utf8");

  it("a pasta cadastra terceirizados nos Parâmetros; o item e o cartão do custo os mostram", () => {
    expect(pasta).toContain("<AbaTerceirizados");
    expect(pasta).toContain('from("produto_terceirizados")');
    expect(bloco).toContain("useTerceirizadosDoProduto");
    expect(item).toContain("custoDosTerceirizados(");
    expect(item).toContain("terceirizadosForm.total");
    expect(custo).toContain('data-testid="custo-de-terceirizados"');
  });

  it("a migração cria a tabela fechada por RLS, e o gatilho do item soma os terceirizados ao custo_formulas", () => {
    expect(migracao).toContain("CREATE TABLE IF NOT EXISTS public.produto_terceirizados");
    expect(migracao).toContain("CHECK (base IN ('peca', 'm2', 'pedido'))");
    expect(migracao).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migracao).toMatch(/custos\.read/);
    expect(migracao).toContain("FROM public.produto_terceirizados t");
    expect(migracao).toContain("WHEN 'm2' THEN t.valor * GREATEST(COALESCE(NEW.largura, 0) * COALESCE(NEW.altura, 0), 0)");
    expect(migracao).toContain("WHEN 'pedido' THEN t.valor / GREATEST(COALESCE(NEW.quantidade, 1), 1)");
    expect(migracao).toContain("UPDATE OF materiais_por_formula, produto_id, largura, altura, quantidade ON public.orcamento_itens");
    expect(migracao).toContain("REVOKE ALL ON FUNCTION public.tg_orcamento_item_custo_das_formulas() FROM PUBLIC, anon, authenticated");
    // O espelho acompanha qualquer UPDATE: custo_formulas muda por dentro quando a medida ou a quantidade mudam.
    expect(migracao).toMatch(/CREATE TRIGGER tg_sync_orcamento_item_custos\s+AFTER INSERT OR UPDATE ON public\.orcamento_itens/);
    expect(migracao).toContain("custo_unitario, custo_formulas, materiais_por_formula, largura, altura, produto_id ON public.orcamento_itens");
  });
});
