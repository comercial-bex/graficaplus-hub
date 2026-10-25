import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SQL = readFileSync("supabase/migrations/20261025750000_acabamento_produto_servico_e_custo_provisorio_pelo_cheio.sql", "utf8");

describe("acabamento → produto de serviço e custo provisório pelo cheio", () => {
  it("liga por coluna os dois acabamentos que já se cobram", () => {
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS produto_servico_id uuid REFERENCES public.produtos(id)");
    expect(SQL).toContain("a.nome = 'Bainha + ilhós' AND p.nome = 'Acabamento de lona (bainha + ilhós)'");
    expect(SQL).toContain("a.nome = 'Laminação de adesivo' AND p.nome = 'Laminação de adesivo'");
  });
  it("só troca o custo dos provisórios, uma vez (idempotente) e sem tocar em preço", () => {
    expect(SQL).toContain("NOT LIKE '%CUSTO CHEIO do produto parecido%'");
    const set = SQL.slice(SQL.lastIndexOf("SET custo_medio"), SQL.lastIndexOf("FROM par"));
    expect(set).not.toMatch(/preco_base|preco_parceiro/);
  });
  it("o custo vem da função do banco, não de número digitado", () => {
    expect(SQL).toContain("public.custo_cheio_do_produto(par.id_irmao)");
  });
});
