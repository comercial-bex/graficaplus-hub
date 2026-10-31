import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cartao = readFileSync("src/components/kanban/cartao-os.tsx", "utf8");
const sql = readFileSync("supabase/migrations/20261031200000_prazo_da_os_212.sql", "utf8");

describe("capa da impressão avulsa e prazo da OS 212 (31/10/2026)", () => {
  it("a OS lançada do RIP não diz 'Sem arte': diz Impressão avulsa", () => {
    expect(cartao).toContain('"Impressão avulsa"');
    expect(cartao).toContain("RIP sem OS");
    // a OS de venda sem arte continua dizendo Sem arte
    expect(cartao).toContain('semArquivo.rotulo === "Sem arte"');
  });

  it("a 212 recebe 5 dias úteis da criação e só se estiver vazio", () => {
    expect(sql).toContain("somar_dias_uteis((created_at AT TIME ZONE 'America/Belem')::date, 5)");
    expect(sql).toContain("numero = 212 AND prazo_entrega IS NULL");
  });
});
