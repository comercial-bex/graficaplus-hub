import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dinheiroDaUnidade } from "../src/lib/pdf/formato";

/**
 * Auditoria orçamento a orçamento (29/10/2026): a área da peça entrava arredondada em
 * 3 casas na conta do preço por m² — 0,001 m² é 10 × 10 cm. Adesivo de 5 × 5 cm pagava
 * 20% a mais; abaixo de 2,2 × 2,2 cm o preço virava zero. Os três gatilhos do banco e o
 * domínio do front passam a usar a área exata (6 casas) e o total da linha em centavos.
 */
const SQL = readFileSync("supabase/migrations/20261029100000_area_exata_no_preco_por_m2.sql", "utf8");

describe("os gatilhos do banco usam a área exata da peça", () => {
  it("as três funções são regravadas com 6 casas", () => {
    for (const fn of ["tg_item_precificar_por_area", "tg_item_os_precificar_por_area", "tg_orcamento_item_custo_do_produto"]) {
      expect(SQL).toContain(`CREATE OR REPLACE FUNCTION public.${fn}()`);
    }
    expect(SQL.match(/round\(NEW\.largura\s*\*\s*NEW\.altura,\s*6\)/g)?.length).toBe(3);
    expect(SQL).not.toMatch(/round\(NEW\.largura\s*\*\s*NEW\.altura,\s*3\)/);
  });

  it("o total da linha sai da área exata e o unitário é o total ÷ peças", () => {
    expect(SQL).toContain("v_total_linha := round(v_area_linha * NEW.preco_m2, 2);");
    expect(SQL).toContain("NEW.valor_unitario := round(v_total_linha / v_qtd, 2);");
    expect(SQL).toContain("v_total_linha := round(v_area_peca * v_qtd * NEW.preco_m2, 2);");
  });

  it("a faixa de parceiro acima de X m² continua", () => {
    expect(SQL).toContain("IF v_preco_acima IS NOT NULL AND NEW.preco_m2 = v_preco_tabela AND v_area_linha > v_limite THEN");
    expect(SQL).toContain("v_total_linha := round(v_limite * v_preco_tabela + (v_area_linha - v_limite) * v_preco_acima, 2);");
  });

  it("o gatilho do orçamento continua SECURITY DEFINER (lê colunas de preço do produto)", () => {
    const inicio = SQL.indexOf("FUNCTION public.tg_item_precificar_por_area()");
    const fim = SQL.indexOf("$function$", SQL.indexOf("AS $function$", inicio) + 1);
    expect(SQL.slice(inicio, fim)).toContain("SECURITY DEFINER");
  });
});

describe("o unitário no papel", () => {
  it("fecha com o total: sai como sempre, em centavos", () => {
    expect(dinheiroDaUnidade(257.25, 3, 771.75)).toBe("R$ 257,25");
    expect(dinheiroDaUnidade(20.68, 1, 20.68)).toBe("R$ 20,68");
    expect(dinheiroDaUnidade(0.08, 1, 0.08)).toBe("R$ 0,08");
  });

  it("não fecha (peça miúda): sai o total ÷ peças com as casas que faltam", () => {
    // 120 adesivos de 5 × 5 cm a R$ 30/m²: R$ 9,00 — R$ 0,075 cada, não R$ 0,08.
    expect(dinheiroDaUnidade(0.08, 120, 9)).toBe("R$ 0,075");
    // 1.000 etiquetas de 1 × 1 cm a R$ 30/m²: R$ 3,00 — R$ 0,003 cada.
    expect(dinheiroDaUnidade(0, 1000, 3)).toBe("R$ 0,003");
    // Quando três casas não bastam, quatro.
    expect(dinheiroDaUnidade(0.42, 50, 21.18)).toBe("R$ 0,4236");
  });

  it("sem total ou com uma peça só, não inventa casas", () => {
    expect(dinheiroDaUnidade(0.08, 1, 0)).toBe("R$ 0,08");
    expect(dinheiroDaUnidade(5, 0, 0)).toBe("R$ 5,00");
  });
});
