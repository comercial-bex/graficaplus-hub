import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const arquivo = "20261121130000_item_da_os_nasce_com_custo.sql";
const migracao = readFileSync(`supabase/migrations/${arquivo}`, "utf8");

describe("migração: o item da OS nasce com o custo do produto (21/11/2026)", () => {
  it("o gatilho é BEFORE INSERT, e só age em linha nova", () => {
    expect(migracao).toMatch(/CREATE TRIGGER tg_itens_os_zz_custo_do_produto\s+BEFORE INSERT ON public\.itens_os/);
    expect(migracao).not.toMatch(/BEFORE (INSERT OR )?UPDATE ON public\.itens_os/);
  });

  it("custo informado, item sem produto e produto sem custo ficam como estão", () => {
    expect(migracao).toContain("IF NEW.produto_id IS NULL OR COALESCE(NEW.custo_unitario, 0) <> 0 THEN");
    expect(migracao).toContain("IF COALESCE(v_custo, 0) <= 0 THEN");
  });

  it("produto por m² com medida: custo por m² × área exata da peça com o mínimo (a conta do preço)", () => {
    expect(migracao).toContain("IN ('m2', 'm²')");
    expect(migracao).toContain("round(NEW.largura * NEW.altura, 6)");
    expect(migracao).toContain("COALESCE(NEW.area_minima, v_area_minima, 0)");
    expect(migracao).toContain("NEW.custo_unitario := round(v_custo * v_area_peca, 2)");
  });

  it("a função de gatilho nasce fechada: REVOKE na mesma migração, conferido com has_function_privilege", () => {
    expect(migracao).toContain(
      "REVOKE ALL ON FUNCTION public.tg_item_os_custo_do_produto() FROM PUBLIC, anon, authenticated;",
    );
    for (const papel of ["anon", "authenticated", "public"]) {
      expect(migracao).toContain(`has_function_privilege('${papel}', 'public.tg_item_os_custo_do_produto()', 'EXECUTE')`);
    }
    expect(migracao).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
  });

  it("o preenchimento dos itens antigos só toca OS aberta, para se o número não for o medido e deixa rastro", () => {
    expect(migracao).toContain("c_esperado constant integer := 6");
    expect(migracao).toContain("os.status::text NOT IN ('concluido', 'faturado', 'cancelado')");
    expect(migracao).toContain("RAISE EXCEPTION 'esperava % itens de OS aberta sem custo, achei %");
    expect(migracao).toContain("'custo_do_item_preenchido'");
    // não mexe em preço nem em orçamento
    expect(migracao).not.toMatch(/UPDATE public\.orcamento_itens/);
    expect(migracao).not.toMatch(/SET\s+(valor_unitario|valor_total|preco_m2)/);
  });

  it("é uma transação só, com o DESFAZER no fim", () => {
    expect(migracao).toMatch(/^BEGIN;$/m);
    expect(migracao).toMatch(/^COMMIT;$/m);
    expect(migracao).toContain("DROP TRIGGER tg_itens_os_zz_custo_do_produto ON public.itens_os;");
  });

  it("o prefixo da migração é único", () => {
    const iguais = readdirSync("supabase/migrations").filter((f) => f.startsWith("20261121130000"));
    expect(iguais).toEqual([arquivo]);
  });
});
