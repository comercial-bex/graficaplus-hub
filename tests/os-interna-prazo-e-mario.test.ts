import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261031100000_os_interna_nasce_com_prazo_e_mario_nas_impressoras.sql",
  "utf8",
);

describe("OS interna nasce com prazo; Mario fora da mesma impressora (31/10/2026)", () => {
  it("o prazo é o padrão da casa, contado do dia de Macapá", () => {
    expect(sql).toContain("precisa_entrega, precisa_instalacao, prazo_entrega)");
    expect(sql).toContain("public.somar_dias_uteis(public.hoje_local()");
    expect(sql).toContain("prazo_entrega_padrao_dias");
  });

  it("as quatro OS do Mario são repartidas só entre as três A1 de mesa igual", () => {
    expect(sql).toContain("numero in (170, 171, 172, 173)");
    expect(sql).not.toContain("f0b28934-b79b-4079-8f89-e6c743dcf093"); // a Mini fica de fora
    expect(sql).toContain("redistribuir_jobs_3d_da_os");
  });
});
