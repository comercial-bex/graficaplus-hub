import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { erroDeMaquina } from "../src/domain/os/comecar-na-maquina";
import { setorDe } from "../src/domain/os/etapas";

/**
 * Achado de 16/11/2026, conferindo a TV da Oficina: a Plotter de Impressão estava
 * "ocupada" desde 10/11 — um apontamento aberto pela agenda na OS 222, com ela ainda
 * no Atendimento (sem validação do gestor, arte, arquivo nem pagamento), nunca
 * fechado. "Começar" na Plotter recusava qualquer outra OS.
 *
 * Ensaio no Postgres (rollback): o apontamento fechou sem tempo e sem custo, a
 * reserva da agenda voltou a "agendado"; abrir tempo de máquina na OS 163
 * (Atendimento) foi recusado; com a Plotter livre, a OS 231 (fila) começou nela.
 * Aplicado em seguida: nenhum apontamento aberto, a 222 sem custo de máquina.
 */

const SQL = readFileSync("supabase/migrations/20261116180000_apontamento_so_depois_do_atendimento.sql", "utf8");

describe("tempo de máquina só depois do Atendimento", () => {
  it("iniciar_apontamento (a única porta do apontamento) recusa OS no Atendimento ou validada sem fila", () => {
    expect(SQL).toContain("if public.etapa_da_os(v_os_status) in ('entrada', 'validado') then");
    expect(SQL).toContain("using detail = 'os_antes_da_producao';");
    // O resto da função segue igual: a máquina ocupada continua recusada.
    expect(SQL).toContain("já está com um apontamento aberto. Finalize antes de começar outro.");
  });

  it("a tela diz o motivo em palavras", () => {
    const e = erroDeMaquina({
      message: "A OS #163 ainda está no atendimento: a produção começa na fila…",
      details: "os_antes_da_producao",
    });
    expect(e.titulo).toBe("OS ainda no atendimento");
    expect(e.descricao).toContain("começa na fila");
  });

  it("o apontamento esquecido da OS 222 fecha sem tempo e sem custo, e a reserva volta a agendada", () => {
    expect(SQL).toContain("SET finalizado_em = iniciado_em,");
    expect(SQL).toContain("WHERE id = v_ap AND finalizado_em IS NULL");
    expect(SQL).toContain("SET status = 'agendado', inicio_real = NULL, fim_real = NULL, minutos_reais = 0");
    expect(SQL).toContain("'apontamento_fechado_sem_tempo'");
    // Sem passar por fechar_apontamento_interno, que lançaria ~9 h de custo de Plotter.
    expect(SQL).not.toContain("fechar_apontamento_interno(");
  });

  it("depois do aval do gestor, quem destrava é a criação", () => {
    expect(setorDe("briefing_ok")).toBe("Design");
  });
});
