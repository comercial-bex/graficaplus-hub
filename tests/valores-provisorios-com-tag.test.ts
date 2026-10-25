import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { custoProvisorio } from "@/domain/precos/tabela-de-precos";

const SQL = readFileSync("supabase/migrations/20261025900000_valores_provisorios_com_tag.sql", "utf8");

describe("valores simbólicos com tag", () => {
  it("todo valor inventado leva PROVISÓRIO na observação, para o aviso achar", () => {
    expect(SQL.match(/observacao = 'PROVISÓRIO \(25\/10\/2026\)/g)?.length).toBe(3);
    expect(SQL).toContain("custo_hora_provisorio");
    expect(custoProvisorio("CUSTO E PREÇO DE BALCÃO PROVISÓRIOS (25/10/2026): valores simbólicos")).toBe(true);
  });
  it("só preenche o que está vazio e é idempotente", () => {
    expect(SQL).toContain("observacao NOT LIKE 'PROVISÓRIO%'");
    expect(SQL).toContain("COALESCE(custo_hora, 0) = 0");
    expect(SQL).toContain("WHERE NOT EXISTS (SELECT 1 FROM public.produtos p WHERE p.nome = n.acab)");
    expect(SQL).toContain("IF position('acabamento_provisorio' IN d) > 0 THEN RETURN; END IF;");
  });
  it("os preços simbólicos são o custo ÷ 60% de margem, arredondado", () => {
    const margem = 0.4;
    expect(Math.ceil((0.5822 / (1 - margem)) * 10) / 10).toBe(1.0); // laser, por minuto
    expect(Math.ceil((0.4346 / (1 - margem)) * 100 / 5) * 5 / 100).toBe(0.75); // manual, por minuto
    expect(Math.ceil((1.305 / (1 - margem)) * 10) / 10).toBe(2.2); // recorte, por metro
  });
  it("o painel ganha os dois avisos novos", () => {
    expect(SQL).toContain("'acabamento_provisorio'");
    expect(SQL).toContain("'custo_de_producao_estimado'");
  });
});
