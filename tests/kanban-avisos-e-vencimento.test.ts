import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  avisoDoStatus,
  fraseDoAviso,
  passoDoMovimento,
  rotuloDoMovimento,
  ultimoMovimentoPorOs,
} from "../src/domain/os/movimentos";

/**
 * 13/10–14/10/2026 — orçamento → OS → Kanban → WhatsApp.
 *
 * Decisões do dono: Saída para entrega avisa o cliente; a arte vai com o link;
 * todos movem o quadro, e o registro de quem fez e quando fica à vista; a
 * parcela única sem data vence na saída do pedido. O lembrete do financeiro
 * de 14/10 às 9h listou 6 parcelas "vencidas" de pedidos convertidos na
 * véspera (R$ 3.746,60) — é o que a regra nova evita.
 */

const SQL = readFileSync("supabase/migrations/20261013230000_kanban_avisos_e_vencimento.sql", "utf8");

describe("o aviso de cada etapa é o mesmo no banco e na tela", () => {
  // Saída de public.marco_notificavel_os para os 26 status, lida no banco vivo
  // em 14/10/2026 depois da migração.
  const NO_BANCO: Record<string, string | null> = {
    entrada: null, aguardando_briefing: null, briefing_ok: null, design: null,
    aguardando_aprovacao_arte: "os_arte_para_aprovar", arte_aprovada: null, arte_rejeitada: null,
    aguardando_producao: null, producao: "os_em_producao", em_producao: "os_em_producao",
    em_impressao: "os_em_producao", em_corte: "os_em_producao", em_acabamento: null,
    em_uv: "os_em_producao", em_laser_cnc: "os_em_producao", em_3d: "os_em_producao",
    controle_qualidade: null, aguardando_retirada: "os_pronta_retirada",
    aguardando_entrega: "os_pronta_entrega", em_entrega: "os_saiu_entrega", em_instalacao: null,
    concluido: "os_concluida", faturado: null, cancelado: null, retrabalho: null, pausado: null,
  };

  it.each(Object.entries(NO_BANCO))("%s", (status, evento) => {
    expect(avisoDoStatus(status)).toBe(evento);
  });

  it("a migração liga a Saída para entrega ao aviso novo", () => {
    expect(SQL).toContain("WHEN _status = 'aguardando_entrega' THEN 'os_pronta_entrega'");
    expect(SQL).toContain("'os_pronta_entrega', 'whatsapp',");
  });
});

describe("depois de mover, a tela diz se o cliente foi avisado", () => {
  it("aviso enfileirado", () => {
    expect(fraseDoAviso("aguardando_entrega", "os_pronta_entrega")).toEqual({
      titulo: "Etapa atualizada · cliente avisado",
      descricao: "Pronto para entregar: sai pelo WhatsApp em até 2 minutos.",
    });
  });
  it("etapa que avisa, mas o aviso não nasceu (sem WhatsApp ou já avisado)", () => {
    expect(fraseDoAviso("em_impressao", null).titulo).toBe("Etapa atualizada · sem aviso ao cliente");
  });
  it("etapa que não avisa", () => {
    expect(fraseDoAviso("design", null)).toEqual({
      titulo: "Etapa atualizada",
      descricao: "Esta etapa não avisa o cliente.",
    });
  });
});

describe("quem moveu e quando", () => {
  const nomes = new Map([["y", "Yvens Costa"], ["h", "Harison"]]);
  const historico = [
    { os_id: "a", status_anterior: null, status_novo: "entrada", mudou_em: "2026-10-13T12:53:36Z", mudou_por: "y" },
    { os_id: "a", status_anterior: "entrada", status_novo: "design", mudou_em: "2026-10-13T19:01:58Z", mudou_por: "h" },
    { os_id: "b", status_anterior: null, status_novo: "entrada", mudou_em: "2026-10-13T12:47:16Z", mudou_por: null },
  ];

  it("o cartão mostra o último movimento de cada OS, no horário de Macapá", () => {
    const ultimos = ultimoMovimentoPorOs(historico);
    expect(rotuloDoMovimento(ultimos.get("a")!, nomes)).toBe("Harison · 13/10 16:01");
    expect(rotuloDoMovimento(ultimos.get("b")!, nomes)).toBe("Sistema · 13/10 09:47");
  });

  it("o histórico diz de onde para onde", () => {
    expect(passoDoMovimento(historico[0])).toBe("Abriu em Entrada");
    expect(passoDoMovimento(historico[1])).toMatch(/^Entrada → /);
  });

  it("a aba Histórico lê os_status_historico (registra toda mudança), não logs_auditoria", () => {
    const ficha = readFileSync("src/routes/_authenticated/os.$id.tsx", "utf8");
    const aba = ficha.slice(ficha.indexOf("function HistoricoTab("), ficha.indexOf("function FinanceiroTab("));
    expect(aba).toContain('.from("os_status_historico")');
    expect(aba).not.toContain('.from("logs_auditoria")');
  });
});

describe("a migração 20261013230000", () => {
  it("OS concluída não volta pelo quadro", () => {
    expect(SQL).toContain("IF v_os.status IN (''concluido'',''faturado'') AND novo_status NOT IN (''concluido'',''faturado'') THEN");
  });

  it("as travas do fechamento ganham o acento que o tradutor de erros da tela exige", () => {
    expect(SQL).toContain("RAISE EXCEPTION ''A OS não pode fechar ainda: %.'', v_texto;");
  });

  it("a arte vai com o link, e cada link é um aviso", () => {
    expect(SQL).toContain("public.url_publica_do_sistema() || ''/aprovar/'' || v_token");
    expect(SQL).toContain("'arte:' || left(md5(v_link), 12)");
    expect(SQL).toContain("'Veja e aprove por este link: ' || v_link");
  });

  it("parcela única sem data vence na saída do pedido", () => {
    expect(SQL).toContain("CASE WHEN v_parcelas = 1 THEN NULL ELSE CURRENT_DATE END");
    expect(SQL).toMatch(/CREATE TRIGGER tg_os_parcela_vence_na_saida\s+AFTER UPDATE OF status ON public\.ordens_servico/);
    expect(SQL).toContain("NEW.status IN ('aguardando_retirada','aguardando_entrega','em_entrega','em_instalacao','concluido','faturado')");
  });

  it("orçamento com 3D converte pela porta do 3D", () => {
    expect(SQL).toContain("RETURN public.converter_orcamento_3d_em_os(");
  });
});
