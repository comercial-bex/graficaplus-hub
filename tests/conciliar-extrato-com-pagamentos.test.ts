import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * O mesmo Pix contado duas vezes no fluxo de caixa (01/11/2026): o pagamento que o sistema
 * registrou e a linha do extrato do banco. A função liga os pares certos e a importação do
 * extrato a chama sozinha. Medido no banco: 9 Pix, R$ 3.197,24 a mais nas entradas.
 */

const SQL = readFileSync("supabase/migrations/20261101170000_conciliar_extrato_com_pagamentos.sql", "utf8");
const CODIGO = SQL.replace(/^\s*--.*$/gm, "");
const TELA = readFileSync("src/routes/_authenticated/contas-bancarias.tsx", "utf8");

describe("a conciliação no banco", () => {
  it("só liga pagamento pago a linha de extrato de entrada ainda sem vínculo", () => {
    expect(CODIGO).toContain("p.status = 'pago'");
    expect(CODIGO).toContain("m.origem = 'extrato' AND m.tipo = 'entrada'");
    expect(CODIGO).toContain("m.pagamento_id IS NULL AND m.conta_pagar_id IS NULL");
    expect(CODIGO).toContain("NOT EXISTS (SELECT 1 FROM public.caixa_movimentos x WHERE x.pagamento_id = p.id)");
  });

  it("valor exato ao centavo e no máximo 3 dias de diferença", () => {
    expect(CODIGO).toContain("abs(m.valor - p.valor) < 0.01");
    expect(CODIGO).toContain("<= 3");
  });

  it("um para um: só liga quando a linha e o pagamento se escolhem, e o empate desempata por id", () => {
    expect(CODIGO).toContain("ordem_do_pagamento = 1 AND ordem_da_linha = 1");
    expect(CODIGO).toContain("ORDER BY c.dif, c.movimento_id");
    expect(CODIGO).toContain("ORDER BY c.dif, c.pagamento_id");
  });

  it("ligar é só preencher pagamento_id: nada é apagado nem alterado de valor", () => {
    expect(CODIGO).toContain("SET pagamento_id = pr.pagamento_id");
    expect(CODIGO).not.toMatch(/\b(DELETE|DROP|TRUNCATE)\b/i);
    expect(CODIGO).not.toMatch(/SET\s+valor\b/i);
  });

  it("repete até não sobrar par certo, no máximo 5 rodadas, e a simulação não liga nada", () => {
    expect(CODIGO).toContain("EXIT WHEN NOT p_aplicar OR v_ligados = 0 OR v_rodada >= 5");
    expect(CODIGO).toContain("WHERE p_aplicar AND m.id = pr.movimento_id");
  });

  it("é do financeiro: quem está logado precisa ver o financeiro, e o público não executa", () => {
    expect(CODIGO).toContain("auth.uid() IS NOT NULL AND NOT public.can_see_financials(auth.uid())");
    expect(CODIGO).toContain("REVOKE ALL ON FUNCTION public.conciliar_extrato_com_pagamentos(boolean) FROM PUBLIC, anon;");
    expect(CODIGO).toContain("GRANT EXECUTE ON FUNCTION public.conciliar_extrato_com_pagamentos(boolean) TO authenticated, service_role;");
  });
});

describe("a importação do extrato", () => {
  it("chama a conciliação depois de importar, aplicando", () => {
    expect(TELA).toContain('rpc("conciliar_extrato_com_pagamentos", { p_aplicar: true })');
  });

  it("se a conciliação falhar, a importação que já deu certo continua valendo", () => {
    const trecho = TELA.slice(TELA.indexOf("let ligados = 0;"), TELA.indexOf("return {\n        ...(data as"));
    expect(trecho).toContain("try {");
    expect(trecho).toContain("catch");
  });

  it("diz quantos Pix ligou", () => {
    expect(TELA).toContain("Pix ligado(s) aos pagamentos do sistema");
  });
});
