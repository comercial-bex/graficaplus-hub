import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migracao = readFileSync(new URL("../supabase/migrations/20261028100000_estorno_que_conta_e_pendencia_de_medida.sql", import.meta.url), "utf8");
const guia = readFileSync(new URL("../src/lib/pendenciasGuia.ts", import.meta.url), "utf8");

describe("estorno que conta e aviso de item sem medida (27/10/2026)", () => {
  it("o pagamento que tem estorno deixa de contar como recebido nas quatro funções que o liam", () => {
    expect(migracao).toContain("'dashboard_caixa','ponto_de_equilibrio','pendencias_do_sistema','confirmar_pagamento'");
    expect(migracao).toContain("NOT EXISTS (SELECT 1 FROM public.pagamentos _r WHERE _r.pagamento_estornado_id");
    expect(migracao).toContain("nada trocado em");
  });

  it("o aviso de medida diz a OS e quem fez o orçamento, e o chaveiro (feito em casa) fica de fora da exceção de revenda", () => {
    expect(migracao).toContain("'item_sem_medida_e_sem_ficha'");
    expect(migracao).toContain("COALESCE(u.nome, 'sem vendedor')");
    expect(migracao.match(/p\.sku <> 'BRI-CHA'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(guia).toContain("item_sem_medida_e_sem_ficha");
  });

  it("OS sem produto não é cobrada de horário de máquina", () => {
    expect(migracao).toMatch(/ix\.produto_id IS NOT NULL/);
  });
});
