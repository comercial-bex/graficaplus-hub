import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const m = readFileSync(new URL("../supabase/migrations/20261028200000_pendencias_tecnicas_resolvidas.sql", import.meta.url), "utf8");

describe("pendências técnicas resolvidas (27/10/2026)", () => {
  it("baixa de estoque só pede baixa de OS com material previsto", () => {
    expect(m).toContain("AND EXISTS (SELECT 1 FROM public.os_materiais_previstos m WHERE m.os_id = os.id)");
  });
  it("agenda de máquina só cobra produto com máquina padrão; terceirizado não tem", () => {
    expect(m).toContain("px.maquina_padrao_id IS NOT NULL OR o.maquina_id IS NOT NULL");
    expect(m).toContain("(Terceirizado)");
  });
  it("o custo/hora das máquinas sai do valor do bem ÷ 10.000 h, sem confundir preço de tabela com patrimônio", () => {
    expect(m).toContain("46398.00 / 10000");
    expect(m).toContain("6994.00 / 10000");
    // o preço de tabela do plotter de recorte NÃO vira valor de aquisição
    expect(m).not.toMatch(/valor_aquisicao = 6994/);
  });
  it("as regras que mudam param se o trecho não for encontrado", () => {
    expect(m.match(/não encontrad[ao]/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
