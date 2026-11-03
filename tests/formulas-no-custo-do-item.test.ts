import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  custoDasFormulas,
  materiaisPorFormula,
  medidasDoItem,
  resumoDasFormulas,
} from "@/domain/orcamentos/material-por-formula";

/**
 * Fase 4 do plano de 02/11/2026: as fórmulas da pasta do produto entram no
 * custo do item do orçamento. A tela calcula a quantidade por peça; o banco
 * multiplica pelo custo de compra (migração 20261102220000).
 */

const ILHOS = { id: "f1", material_id: "m-ilhos", script: "teto(perimetro / 0,5)", material: { nome: "Ilhós metálico", unidade: "un" } };
const BASTAO = { id: "f2", material_id: "m-bastao", script: "2 * copias", material: { nome: "Bastão", unidade: "un" } };
const FITA = { id: "f3", material_id: "m-ilhos", script: "perimetro", material: { nome: "Ilhós metálico", unidade: "un" } };

describe("material por fórmula", () => {
  it("roda a fórmula na medida do item: lona de 2 × 1 m leva 12 ilhós a cada 50 cm", () => {
    const r = materiaisPorFormula([ILHOS, BASTAO], medidasDoItem({ largura: 2, altura: 1, quantidade: 3 }));
    expect(r.linhas.map((l) => [l.nome, l.quantidade, l.erro])).toEqual([
      ["Ilhós metálico", 12, null],
      ["Bastão", 2, null],
    ]);
    expect(r.validas).toEqual([
      { material_id: "m-ilhos", quantidade: 12 },
      { material_id: "m-bastao", quantidade: 2 },
    ]);
  });

  it("o mesmo material em duas fórmulas vira uma linha só para o banco", () => {
    const r = materiaisPorFormula([ILHOS, FITA], medidasDoItem({ largura: 2, altura: 1, quantidade: 1 }));
    expect(r.linhas).toHaveLength(2);
    expect(r.validas).toEqual([{ material_id: "m-ilhos", quantidade: 18 }]);
  });

  it("fórmula errada ou zerada aparece com o erro e fica fora da gravação", () => {
    const errada = { ...ILHOS, id: "f9", script: "teto(perimetro /" };
    const zero = { ...BASTAO, id: "f8", script: "largura - 2" };
    const r = materiaisPorFormula([errada, zero], medidasDoItem({ largura: 2, altura: 1, quantidade: 1 }));
    expect(r.linhas[0].erro).toBeTruthy();
    expect(r.linhas[1].erro).toMatch(/zero/);
    expect(r.validas).toEqual([]);
  });

  it("sem medida, a peça vale zero e a quantidade vale um", () => {
    expect(medidasDoItem({ largura: null, altura: undefined, quantidade: 0 })).toEqual({
      largura: 0,
      altura: 0,
      copias: 1,
      quantidade: 1,
    });
  });

  it("o custo por peça usa o custo de compra; material sem custo é apontado", () => {
    const custo = custoDasFormulas(
      [
        { material_id: "m-ilhos", quantidade: 12 },
        { material_id: "m-bastao", quantidade: 2 },
      ],
      new Map([["m-ilhos", 0.35]]),
    );
    expect(custo).toEqual({ total: 4.2, semCusto: ["m-bastao"] });
  });

  it("o resumo escreve o que entra", () => {
    const r = materiaisPorFormula([ILHOS, BASTAO], medidasDoItem({ largura: 2, altura: 1, quantidade: 1 }));
    expect(resumoDasFormulas(r.linhas)).toBe("Ilhós metálico 12 un · Bastão 2 un");
  });
});

describe("as telas e o banco", () => {
  const item = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
  const pasta = readFileSync("src/routes/_authenticated/produtos_.$id.tsx", "utf8");
  const custo = readFileSync("src/components/produtos/custo-da-peca.tsx", "utf8");
  const bloco = readFileSync("src/components/orcamento/material-por-formula.tsx", "utf8");
  const migracao = readFileSync("supabase/migrations/20261102220000_formulas_no_custo_do_item.sql", "utf8");

  it("o item grava só a quantidade por peça e soma o custo das fórmulas no total e na margem", () => {
    expect(item).toContain("materiais_por_formula: calculoDasFormulas.validas,");
    expect(item).toContain('"valor_total, custo_unitario, custo_formulas, quantidade"');
    expect(item).toContain("(Number(i.custo_unitario ?? 0) + Number(i.custo_formulas ?? 0)) * Number(i.quantidade ?? 0)");
    expect(item).toContain("valorUnitarioEfetivo - custoUnitarioForm - (custoFormulasForm?.total ?? 0)");
    expect(item).toMatch(/<MaterialPorFormula\s+linhas=\{calculoDasFormulas\.linhas\}\s+custo=\{custoFormulasForm\}/);
    // Quem não vê custo não consulta o custo do material.
    expect(bloco).toContain("enabled: habilitado && ids.length > 0");
    expect(bloco).toContain('fromFinancialView("materiais", "financeiro")');
  });

  it("a pasta diz que a fórmula entra no custo e mostra o material por fórmula na medida padrão", () => {
    expect(pasta).not.toContain("As fórmulas ainda não entram no custo do orçamento.");
    expect(pasta).toContain('data-testid="formulas-entram-no-custo"');
    expect(custo).toContain('data-testid="custo-por-formula"');
    expect(custo).toContain('.from("produto_formulas")');
  });

  it("a migração: colunas, grants por coluna, gatilho, espelho, view com a coluna no fim e a conversão em OS", () => {
    expect(migracao).toContain("ADD COLUMN IF NOT EXISTS materiais_por_formula jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(migracao).toContain("ADD COLUMN IF NOT EXISTS custo_formulas numeric NOT NULL DEFAULT 0");
    expect(migracao).toContain("GRANT SELECT (materiais_por_formula), INSERT (materiais_por_formula), UPDATE (materiais_por_formula)");
    // Custo não ganha SELECT para authenticated: segue protegido como custo_unitario.
    expect(migracao).not.toMatch(/GRANT SELECT \([^)]*custo_formulas/);
    expect(migracao).toContain("BEFORE INSERT OR UPDATE OF materiais_por_formula ON public.orcamento_itens");
    expect(migracao).toContain("custo_formulas = EXCLUDED.custo_formulas");
    expect(migracao).toContain("WITH (security_invoker = true)");
    expect(migracao).toMatch(/oi\.gerado_por_item_id,\s*oic\.custo_formulas\s*FROM public\.orcamento_itens oi/);
    expect(migracao).toContain("(COALESCE(i.custo_unitario, 0) + COALESCE(i.custo_formulas, 0)) * COALESCE(i.quantidade, 0)");
    expect(migracao).toContain("custo_unitario + COALESCE(custo_formulas, 0), ordem, produto_snapshot");
  });
});
