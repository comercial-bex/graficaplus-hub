import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CUSTO DOS MATERIAIS PELO QUE A CAMALEÃO COBROU (26/10/2026).
 *
 * O dono decidiu trocar o custo do cadastro pelo que se paga, sabendo que os
 * gatilhos refazem pela receita o custo de 19 produtos. A migração aplica, anota
 * os valores de antes para desfazer e resolve a decisão no painel. O teste
 * confere que os números saem das compras registradas (prints do ControlShop)
 * e que a migração não passa da conta: só a tinta de 22/10 a R$ 0,09 é corrigida
 * no estoque, e rodar de novo não faz nada.
 */

const SQL_COMPLETO = readFileSync(
  join(__dirname, "..", "supabase/migrations/20261027950000_custo_dos_materiais_pelo_que_se_paga.sql"),
  "utf8",
);
const SQL = SQL_COMPLETO.replace(/--[^\n]*/g, "");

const duas = (v: number) => Math.round(v * 100) / 100;

describe("os números saem das compras na Camaleão", () => {
  it("vinil branco: último pago R$ 340 ÷ 53 m²; médio dos 7 rolos (380 + 360 + 5 × 340) ÷ 371 m²", () => {
    expect(duas(340 / 53)).toBe(6.42);
    expect(duas((380 + 360 + 1700) / (7 * 53))).toBe(6.58);
    expect(SQL).toContain("SET custo_unitario = 6.42, custo_medio = 6.58, fornecedor = 'Camaleão Tintas'");
  });

  it("lona 280: R$ 580 ÷ 80 m²; perfurado: R$ 400 ÷ 63,5 m², bobina de 1,27 m", () => {
    expect(duas(580 / 80)).toBe(7.25);
    expect(duas(400 / 63.5)).toBe(6.3);
    expect(SQL).toContain("SET custo_unitario = 7.25, custo_medio = 7.25, fornecedor = 'Camaleão Tintas'");
    expect(SQL).toContain("SET custo_unitario = 6.30, custo_medio = 6.30, fornecedor = 'Camaleão Tintas', largura_bobina_m = 1.27");
  });

  it("tinta: R$ 231,70 o litro = 0,2317/ml nos lotes; 0,23 no cadastro (2 casas)", () => {
    expect(231.7 / 1000).toBeCloseTo(0.2317, 6);
    expect(SQL).toContain("custo_unitario_snapshot = 0.2317");
    expect(SQL).toContain("SET custo_unitario = 0.23, custo_medio = 0.23, fornecedor = 'Camaleão Tintas'");
    // 4.000 ml × 0,2317 = os R$ 926,80 dos quatro litros.
    expect(duas(6 * 0.2317 + 3994 * 0.2317)).toBe(926.8);
  });
});

describe("a migração não passa da conta", () => {
  it("no estoque, só a tinta lançada em 22/10 a R$ 0,09 — lote e entrada", () => {
    for (const tabela of ["material_lotes", "movimentacoes_estoque"]) {
      const bloco = new RegExp(`UPDATE public\\.${tabela}[\\s\\S]*?;`).exec(SQL)?.[0] ?? "";
      expect(bloco, tabela).toContain("material_id = v_tinta");
      expect(bloco, tabela).toContain("custo_unitario_snapshot = 0.09");
      expect(bloco, tabela).toContain("created_at >= '2026-10-22' AND created_at < '2026-10-23'");
    }
    expect(SQL).toContain("tipo::text = 'entrada'");
  });

  it("não escreve direto em produtos, preços, caixa ou contas: o custo dos produtos vem dos gatilhos", () => {
    for (const tabela of ["produtos", "produto_precos", "produto_precificacao", "caixa_movimentos", "contas_pagar", "orcamento_itens"]) {
      expect(SQL, tabela).not.toMatch(new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+public\\.${tabela}\\b`, "i"));
    }
  });

  it("roda uma vez só: sai se a decisão já foi resolvida, e resolve com a resposta do dono", () => {
    expect(SQL).toMatch(/IF EXISTS \(SELECT 1 FROM public\.decisoes_pendentes\s+WHERE chave = 'custo_dos_materiais_pelo_que_se_paga' AND resolvida_em IS NOT NULL\) THEN\s+RETURN;/);
    expect(SQL).toContain("Pode continuar a resolver. Resolva tudo que precisa resolver.");
  });

  it("o cabeçalho guarda como desfazer: os 4 materiais, a tinta do estoque e o custo dos 19 produtos", () => {
    const desfazer = SQL_COMPLETO.slice(SQL_COMPLETO.indexOf("DESFAZER"));
    for (const nome of [
      "Adesivo perfurado (one way) 34",
      "Adesivo vinil\n--     branco impresso 22",
      "Lona 280g impressa 18",
      "Lona 440g reforçada impressa 18,30",
      "Placa ACM 3mm com\n--     adesivo 145",
      "Placa PS 2mm com adesivo 62",
      "Placa PVC expandido 3mm 78",
      "Testeira 90 × 12 1,14",
    ]) {
      expect(desfazer, nome).toContain(nome);
    }
    expect(desfazer).toContain("tinta 0,09/0,09");
    expect(desfazer).toContain("perfurado 22,00/22,00 largura 1,06");
  });
});
