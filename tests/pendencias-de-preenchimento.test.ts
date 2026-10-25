import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUIA_PENDENCIAS, VISIVEL_TAMBEM_PARA } from "../src/lib/pendenciasGuia";

const SQL = readFileSync(
  "supabase/migrations/20261025800000_pendencias_de_preenchimento.sql",
  "utf8",
);
const HOOK = readFileSync("src/hooks/usePendencias.ts", "utf8");
const PAINEL = readFileSync("src/components/painel/PendenciasDoMeuPapel.tsx", "utf8");

const CHAVES = [
  ["produto_custo_provisorio", "financeiro"],
  ["produto_sem_custo", "financeiro"],
  ["produto_sem_preco", "financeiro"],
  ["acabamento_sem_preco", "financeiro"],
  ["material_sem_estoque_maximo", "gestao"],
] as const;

describe("pendências de preenchimento", () => {
  it.each(CHAVES)("%s existe no banco para %s e tem guia na tela", (chave, quem) => {
    expect(SQL).toContain(`'${chave}'`);
    expect(SQL).toMatch(new RegExp(`'${chave}'[\\s\\S]{0,600}'${quem}'`));
    expect(GUIA_PENDENCIAS[chave], `${chave} sem guia`).toBeTruthy();
  });

  it("custo e preço só voltam para quem vê dinheiro", () => {
    const antes = SQL.slice(0, SQL.indexOf("'produto_custo_provisorio'"));
    expect(antes).toContain("IF v_ve_dinheiro THEN");
    const depoisDoFim = SQL.slice(SQL.indexOf("END IF;"));
    expect(depoisDoFim).toContain("'material_sem_estoque_maximo'");
  });

  it("o produto provisório sai do aviso quando a observação some", () => {
    expect(SQL).toContain("observacoes_internas LIKE '%PROVISÓRIOS%'");
  });

  it("a função nova não é pública", () => {
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public.pendencias_de_preenchimento() FROM PUBLIC, anon",
    );
  });

  it("o painel junta as duas listas e o gestor também vê as de custo e preço", () => {
    expect(HOOK).toContain("pendencias_de_preenchimento");
    expect(PAINEL).toContain("VISIVEL_TAMBEM_PARA");
    for (const [chave] of CHAVES.filter(([, q]) => q === "financeiro")) {
      expect(VISIVEL_TAMBEM_PARA[chave], chave).toContain("gestor");
    }
  });
});
