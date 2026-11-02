import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `orcamento_itens` dá SELECT coluna a coluna, e as views `_financeiro` e `_operacional` leem com a permissão de
 * quem chama. Coluna nova numa dessas views sem GRANT derruba a tela de itens para quase todo mundo (02/11/2026).
 */
describe("coluna nova em orcamento_itens", () => {
  const pasta = "supabase/migrations";
  const nomes = readdirSync(pasta).filter((n) => n >= "20261102");
  const todas = nomes.map((n) => readFileSync(`${pasta}/${n}`, "utf8")).join("\n");

  it("toda coluna acrescentada desde 02/11 tem a leitura liberada ou é decisão escrita", () => {
    const novas = [...todas.matchAll(/ALTER TABLE public\.orcamento_itens ADD COLUMN(?: IF NOT EXISTS)? (\w+)/g)].map((m) => m[1]);
    expect(novas).toContain("respostas");
    for (const coluna of novas) {
      expect(todas, `falta GRANT SELECT (${coluna})`).toMatch(new RegExp(`GRANT SELECT \\([^)]*\\b${coluna}\\b[^)]*\\) ON public\\.orcamento_itens TO authenticated`));
    }
  });
});
