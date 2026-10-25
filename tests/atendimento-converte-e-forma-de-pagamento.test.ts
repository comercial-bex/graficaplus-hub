import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { rolePermissions } from "@/lib/permissions";

const SQL = readFileSync("supabase/migrations/20261026100000_atendimento_converte_e_forma_de_pagamento.sql", "utf8");

describe("o atendimento autoriza e converte o orçamento em OS", () => {
  it("o vendedor tem aprovar e converter no espelho do código e na migração", () => {
    expect(rolePermissions.vendedor).toContain("orcamentos.approve");
    expect(rolePermissions.vendedor).toContain("orcamentos.convert");
    expect(SQL).toContain("('orcamentos.approve'), ('orcamentos.convert')");
  });
  it("não ganha o que é do financeiro nem da gerência", () => {
    for (const k of ["pagamentos.create", "pagamentos.confirm", "pagamentos.reverse", "os.close", "os.status.override", "financeiro.read"]) {
      expect(rolePermissions.vendedor as readonly string[]).not.toContain(k);
    }
  });
  it("a migração é idempotente", () => {
    expect(SQL).toContain("WHERE NOT EXISTS (SELECT 1 FROM public.perfil_permissoes x");
    expect(SQL).toContain("DROP TRIGGER IF EXISTS tg_pagamento_forma_minuscula");
  });
  it("a forma de pagamento é gravada em minúsculas", () => {
    expect(SQL).toContain("NEW.forma_pagamento := lower(btrim(NEW.forma_pagamento))");
  });
});

describe("tela de orçamentos", () => {
  const LISTA = readFileSync("src/routes/_authenticated/orcamentos.index.tsx", "utf8");
  it("esconde as cascas (rejeitado/expirado sem valor e sem OS) só para quem vê preço", () => {
    expect(LISTA).toContain('canSeePrices && ["rejeitado", "expirado"].includes(o.status)');
    expect(LISTA).toContain("rejeitados/expirados sem valor");
  });
});

import { GUIA_PENDENCIAS } from "@/lib/pendenciasGuia";

const SQL2 = readFileSync("supabase/migrations/20261026200000_entrega_na_conversao_e_alertas_de_fluxo.sql", "utf8");

describe("a entrega nasce com a OS e três alertas de fluxo", () => {
  it("a conversão cria a entrega quando o pedido pede, como acessório", () => {
    expect(SQL2).toContain("INSERT INTO public.entregas_instalacoes(os_id, tipo, endereco, status)");
    expect(SQL2).toContain("COALESCE(v_orc.endereco_entrega->>''descricao'', v_orc.endereco_entrega::text)");
    expect(SQL2).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(SQL2).toContain("IF position('entregas_instalacoes' IN d) > 0 THEN RETURN; END IF;");
  });
  it.each([
    ["os_paga_sem_producao", "atendimento"],
    ["os_sem_prazo", "atendimento"],
    ["os_sem_agenda", "gestao"],
  ])("%s existe no banco para %s e tem guia na tela", (chave, quem) => {
    expect(SQL2).toMatch(new RegExp(`'${chave}'[\\s\\S]{0,500}'${quem}'`));
    expect(GUIA_PENDENCIAS[chave], `${chave} sem guia`).toBeTruthy();
  });
  it("estorno não conta como pagamento no alerta de OS paga", () => {
    expect(SQL2).toContain("p.pagamento_estornado_id IS NULL");
  });
});
