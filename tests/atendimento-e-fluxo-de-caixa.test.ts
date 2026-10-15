import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 14/10/2026 — "continue a resolver".
 *   - Dani Muniz (cliente com a OS #165) e "Gratidão" esperavam resposta no
 *     WhatsApp havia 9 e 8 dias, e nada avisava ninguém.
 *   - A única baixa real (Guilherme, R$ 121,15, 10/10) não aparecia no fluxo
 *     de caixa: a view datava por data_vencimento, que a baixa não grava.
 *   - O estorno entrava como "não realizado" e o dinheiro devolvido continuava
 *     contado como entrada.
 *   - Lead convertido deixava a conversa "sem cliente"; cliente com WhatsApp
 *     diferente do telefone virava lead desconhecido.
 *   - Cancelar a OS no seletor da ficha era um toque, sem confirmação.
 */

const SQL = readFileSync("supabase/migrations/20261014120000_atendimento_e_fluxo_de_caixa.sql", "utf8");

describe("cliente esperando resposta no WhatsApp", () => {
  it("vira pendência do atendimento, crítica depois de um dia, com quem espera e desde quando", () => {
    expect(SQL).toContain("''whatsapp_esperando_resposta'', ''Clientes esperando resposta no WhatsApp''");
    expect(SQL).toContain("CASE WHEN min(c.aguardando_desde) < now() - interval ''1 day'' THEN ''critico'' ELSE ''atencao'' END");
    expect(SQL).toContain("''/whatsapp-fila-humana''");
  });

  it("entra no lembrete diário da gerência e conta para o silêncio", () => {
    expect(SQL).toContain("IF v_qtd = 0 AND v_os_qtd = 0 AND v_wa_qtd = 0 THEN");
    expect(SQL).toContain("Clientes esperando resposta no WhatsApp: %s.");
  });
});

describe("fluxo de caixa", () => {
  it("a baixa é datada pelo dia em que o dinheiro entrou", () => {
    expect(SQL).toMatch(
      /CASE WHEN p\.status = 'pago'::status_pagamento OR p\.pagamento_estornado_id IS NOT NULL\s+THEN COALESCE\(p\.data_pagamento, p\.data_vencimento\)/,
    );
  });

  it("o estorno conta como realizado (valor negativo desconta a entrada)", () => {
    expect(SQL).toContain(
      "(p.status = 'pago'::status_pagamento OR p.pagamento_estornado_id IS NOT NULL) AS realizado",
    );
  });

  it("a view continua com security_invoker", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE VIEW public\.vw_fluxo_caixa\s+WITH \(security_invoker = true\)/);
  });
});

describe("conversa e cliente", () => {
  it("lead convertido leva a conversa", () => {
    expect(SQL).toContain("UPDATE public.whatsapp_conversas SET cliente_id = v_cliente_id");
    expect(SQL).toContain("WHERE cliente_id IS NULL AND (lead_id = p_lead_id OR id = v_lead.conversa_id);");
  });

  it("o WhatsApp principal identifica o cliente na mensagem que chega", () => {
    expect(SQL).toContain(
      "SELECT id FROM public.clientes WHERE public.normalize_whatsapp_phone(whatsapp_principal) = v_tel",
    );
  });
});

describe("cancelar a OS pede confirmação e motivo", () => {
  const quadro = readFileSync("src/routes/_authenticated/kanban.tsx", "utf8");

  it("o seletor da ficha não cancela num toque", () => {
    expect(quadro).toContain('if (novo === "cancelado") {');
    expect(quadro).toContain("setCancelando(");
    expect(quadro).toContain("<AlertDialogTitle>Cancelar a OS #");
  });

  it("o motivo é obrigatório e fica no rastro só se o cancelamento passou", () => {
    expect(quadro).toContain("disabled={motivoDoCancelamento.trim().length < 5}");
    expect(quadro).toMatch(/const cancelou = await mover\(alvoId, "cancelado"\);\s+if \(cancelou\)/);
    expect(quadro).toContain('acao: "cancelamento"');
  });
});
