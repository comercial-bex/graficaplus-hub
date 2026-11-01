import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COLUNAS_DA_JANELA, lerJanelas } from "../src/domain/financeiro/janelas-de-vencimento";
import { JanelasDeVencimentoView } from "../src/components/painel/JanelasDeVencimento";

/**
 * Dinheiro a vencer no painel inicial (31/10/2026), Onda 4 do plano
 * `docs/plano-interface-holdprint-31-10-2026.md`: a receber e a pagar em hoje,
 * amanhã, 7 e 30 dias, com o atrasado à parte.
 */

const RESPOSTA = {
  hoje: "2026-10-31",
  ate_7_dias: "2026-11-06",
  ate_30_dias: "2026-11-29",
  receber: { atrasado: 685.4, hoje: 0, amanha: 0, dias7: 2557.5, dias30: 2557.5 },
  pagar: { atrasado: 0, hoje: 0, amanha: 0, dias7: 2309, dias30: 5289.74 },
};

describe("lerJanelas", () => {
  it("lê a resposta da função", () => {
    const d = lerJanelas(RESPOSTA);
    expect(d.hoje).toBe("2026-10-31");
    expect(d.receber).toEqual({ atrasado: 685.4, hoje: 0, amanha: 0, dias7: 2557.5, dias30: 2557.5 });
    expect(d.pagar.dias30).toBe(5289.74);
  });

  it("número que chega como texto vale o número; nulo, ausente ou lixo vale zero, nunca NaN", () => {
    const d = lerJanelas({ receber: { atrasado: "12.50", hoje: null, amanha: "abc", dias7: undefined }, pagar: null });
    expect(d.receber).toEqual({ atrasado: 12.5, hoje: 0, amanha: 0, dias7: 0, dias30: 0 });
    expect(d.pagar).toEqual({ atrasado: 0, hoje: 0, amanha: 0, dias7: 0, dias30: 0 });
    expect(d.hoje).toBeNull();
    expect(lerJanelas(null).receber.hoje).toBe(0);
  });

  it("as colunas vêm na ordem do olhar: hoje, amanhã, 7 dias, 30 dias", () => {
    expect(COLUNAS_DA_JANELA.map((c) => c.rotulo)).toEqual(["Hoje", "Amanhã", "7 dias", "30 dias"]);
  });
});

describe("os cartões na tela", () => {
  const html = (dados = lerJanelas(RESPOSTA)) =>
    renderToStaticMarkup(createElement(JanelasDeVencimentoView, { dados })).replace(/ /g, " ");

  it("mostra a receber e a pagar com as quatro janelas e os valores em reais", () => {
    const h = html();
    expect(h).toContain("Total a receber");
    expect(h).toContain("Total a pagar");
    for (const rotulo of ["Hoje", "Amanhã", "7 dias", "30 dias"]) expect(h).toContain(rotulo);
    expect(h).toContain("R$ 2.557,50");
    expect(h).toContain("R$ 5.289,74");
  });

  it("o atrasado aparece sozinho, em vermelho, e some quando não há", () => {
    const h = html();
    expect(h).toContain("Atrasado: R$ 685,40");
    expect(h).toContain("Nada atrasado");
  });

  it("hoje é o número grande: verde para receber, vermelho para pagar", () => {
    const h = html();
    expect(h).toMatch(/text-2xl text-success/);
    expect(h).toMatch(/text-2xl text-destructive/);
  });

  it("a letra não passa abaixo de 14 px (nada de text-xs)", () => {
    expect(/text-xs/.test(html()), "sobrou text-xs").toBe(false);
  });
});

describe("encaixe e banco", () => {
  const PAINEL = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
  const SQL = readFileSync("supabase/migrations/20261101004500_vencimentos_por_janela.sql", "utf8");

  it("só quem vê financeiro monta o cartão no painel inicial", () => {
    expect(PAINEL).toContain("{canSeeFinancials && <JanelasDeVencimento />}");
  });

  it("a função usa o hoje do Brasil, recusa quem não vê financeiro e não abre para anon", () => {
    expect(SQL).toContain("public.hoje_br()");
    expect(SQL, "current_date é UTC: das 21h à meia-noite 'hoje' vira amanhã").not.toMatch(/current_date|CURRENT_DATE|now\(\)::date/);
    expect(SQL).toContain("public.can_see_financials(auth.uid())");
    expect(SQL).toContain("ERRCODE = '42501'");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.vencimentos_por_janela() FROM PUBLIC, anon;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.vencimentos_por_janela() TO authenticated, service_role;");
  });

  it("as janelas são móveis, a receber é parcela não paga e a pagar é conta aberta", () => {
    expect(SQL).toContain("v_hoje + 6");
    expect(SQL).toContain("v_hoje + 29");
    expect(SQL).toContain("p.status <> 'paga'");
    expect(SQL).toContain("c.status::text = 'aberta'");
  });
});
