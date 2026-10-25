import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COLUNAS_DO_ACORDO } from "@/components/orcamento/acordo-do-orcamento";

const SQL = readFileSync("supabase/migrations/20261026500000_grants_prazo_tipo_e_familia.sql", "utf8");

describe("colunas novas precisam de GRANT de leitura", () => {
  it("o quadro de acordo pede prazo_tipo, então a coluna tem de estar liberada", () => {
    expect(COLUNAS_DO_ACORDO).toContain("prazo_tipo");
    expect(SQL).toContain("GRANT SELECT (prazo_tipo) ON public.orcamentos TO authenticated;");
  });
  it("a família do produto lê direto da tabela, então também", () => {
    expect(SQL).toContain("GRANT SELECT (familia) ON public.produtos TO authenticated;");
  });
  it("não abre nenhuma coluna de dinheiro", () => {
    expect(SQL).not.toMatch(/GRANT SELECT \([^)]*(valor|preco|custo|margem|desconto)/);
  });
});
