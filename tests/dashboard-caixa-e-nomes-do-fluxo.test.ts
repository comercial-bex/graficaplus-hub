import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ROTULO_ETAPA } from "../src/domain/os/etapas";

/**
 * 24/10/2026: o dono dava baixa e o dashboard não mexia — o "Faturamento" é o
 * valor das OS vendidas, não dinheiro recebido. Agora há o bloco "Caixa" (lido
 * de pagamentos) e toda tela que mexe em pagamento invalida o painel.
 */
const DASH = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
const SQL = readFileSync("supabase/migrations/20261024140000_dashboard_caixa.sql", "utf8");

describe("caixa no dashboard", () => {
  it("o painel lê dashboard_caixa e se relê sozinho", () => {
    expect(DASH).toContain('rpc as any)("dashboard_caixa")');
    expect(DASH).toContain("refetchInterval: 60_000");
    expect(DASH).toContain("Recebido hoje");
    expect(DASH).toContain("não é dinheiro recebido");
  });
  it("a função soma só pagamento pago e não estornado, e só para quem vê financeiro", () => {
    expect(SQL).toContain("status = 'pago' AND pagamento_estornado_id IS NULL");
    expect(SQL).toContain("can_see_financials(auth.uid())");
    expect(SQL).toContain("America/Belem");
  });
  it.each([
    "src/routes/_authenticated/a-receber.tsx",
    "src/routes/_authenticated/financeiro.tsx",
    "src/routes/_authenticated/os.$id.tsx",
  ])("%s invalida o painel depois de mexer em pagamento", (arquivo) => {
    expect(readFileSync(arquivo, "utf8")).toContain("invalidarPainelDoCaixa(qc)");
  });
});

describe("nomes das colunas do quadro", () => {
  it("falam a língua do dono", () => {
    expect(ROTULO_ETAPA.entrada).toBe("Atendimento");
    expect(ROTULO_ETAPA.pre_impressao).toBe("Criação");
    expect(ROTULO_ETAPA.producao).toBe("Produção");
    expect(ROTULO_ETAPA.saida).toBe("Entrega e finalizado");
  });
});
