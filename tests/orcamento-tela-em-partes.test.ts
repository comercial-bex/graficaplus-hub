import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROTA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
const PARTES = ["CabecalhoIdentificacao", "PassoCliente", "PassoPrazoEEntrega", "PassoRevisao", "ResumoLateral"];

/**
 * A tela do orçamento da equipe tinha 3.100 linhas num componente só. Foi dividida em partes sem mudar
 * comportamento (03/11/2026): cada parte recebe por propriedade o que antes lia do escopo da rota.
 * Este teste impede a volta do monólito e o sumiço de uma parte que a rota ainda usa.
 */
describe("a tela do orçamento em partes", () => {
  it.each(PARTES)("%s existe e a rota a usa", (nome) => {
    expect(existsSync(`src/components/orcamento/tela/${nome}.tsx`)).toBe(true);
    expect(ROTA).toContain(`<${nome} `);
    expect(ROTA).toContain(`from "@/components/orcamento/tela/${nome}"`);
  });

  it("as constantes compartilhadas moram num lugar só", () => {
    const comum = readFileSync("src/components/orcamento/tela/comum.ts", "utf8");
    for (const nome of ["statusTone", "ROTULO_DO_STATUS", "ONDE_RESOLVER"]) {
      expect(comum).toContain(`export const ${nome}`);
      expect(ROTA).not.toMatch(new RegExp(`^const ${nome}\\b`, "m"));
    }
  });

  it("a rota não volta a passar de 2.800 linhas sem decisão consciente", () => {
    expect(ROTA.split("\n").length).toBeLessThan(2800);
  });
});
