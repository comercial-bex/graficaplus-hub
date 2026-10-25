import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GUIA_PENDENCIAS } from "@/lib/pendenciasGuia";

const SQL = readFileSync("supabase/migrations/20261026000000_alertas_de_pagamento_e_orcamento_convertido.sql", "utf8");

describe("alertas de pagamento e orçamento convertido", () => {
  it.each(["pagamento_sem_parcela", "pagamento_acima_da_conta"])("%s existe no banco para o financeiro e tem guia na tela", (chave) => {
    expect(SQL).toContain(`'${chave}'`);
    expect(SQL).toMatch(new RegExp(`'${chave}'[\\s\\S]{0,400}'financeiro'`));
    expect(GUIA_PENDENCIAS[chave], `${chave} sem guia`).toBeTruthy();
  });
  it("só mexe no orçamento #106, e só se ainda estiver aprovado com OS (idempotente e reversível)", () => {
    expect(SQL).toContain("WHERE numero = 106 AND status::text = 'aprovado' AND os_id IS NOT NULL");
  });
  it("estorno não conta como recebido nem como pagamento solto", () => {
    expect(SQL.match(/pagamento_estornado_id IS NULL/g)?.length).toBe(2);
  });
  it("a função só é recriada uma vez (guarda de idempotência)", () => {
    expect(SQL).toContain("IF position('pagamento_sem_parcela' IN d) > 0 THEN RETURN; END IF;");
  });
});
