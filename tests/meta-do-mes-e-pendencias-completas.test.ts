import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GUIA_PENDENCIAS } from "../src/lib/pendenciasGuia";

/**
 * 24/10/2026: a Meta do mês só contava OS CONCLUÍDAS (R$ 121,15) com R$ 5.428,89
 * em orçamentos aprovados e R$ 3.121,49 recebidos no mês. Agora vendido, recebido
 * e concluído aparecem lado a lado. Ensaio no banco: vendido 5.428,89 (19
 * orçamentos), recebido 3.121,49, concluído 121,15, 14 OS abertas.
 */
const SQL = readFileSync("supabase/migrations/20261024220000_meta_do_mes_e_pendencias_completas.sql", "utf8");
const META = readFileSync("src/components/painel/MetaDoMes.tsx", "utf8");
const DASH = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");

describe("meta do mês", () => {
  it("o banco entrega vendido, recebido e as contagens de OS", () => {
    for (const k of ["'vendido'", "'recebido'", "'orcamentos_aprovados_n'", "'os_concluidas_n'", "'os_abertas_n'"]) {
      expect(SQL).toContain(k);
    }
  });
  it("a tela usa o vendido como número principal e explica o concluído baixo", () => {
    expect(META).toContain("vendido no mês");
    expect(META).toContain("Faltam receber para pagar as contas");
    expect(META).toContain("foram fechadas no sistema");
  });
});

describe("pendências que faltavam", () => {
  it.each([
    ["os_prazo_vencido", "atendimento"],
    ["arte_aprovada_sem_aceite", "atendimento"],
    ["catalogo_cotacao_sem_atendimento", "atendimento"],
    ["parceiro_sem_atendente", "gestao"],
    ["apontamento_aberto_esquecido", "producao"],
    ["parcela_sem_vencimento", "financeiro"],
  ])("%s existe no banco para %s e tem guia na tela", (chave, quem) => {
    expect(SQL).toContain(`'${chave}'`);
    expect(SQL).toMatch(new RegExp(`'${chave}'[\\s\\S]{0,400}'${quem}'`));
    expect(GUIA_PENDENCIAS[chave], `${chave} sem guia`).toBeTruthy();
  });
});

describe("estoque e retrabalho no painel", () => {
  it("estoque crítico soma zerados e no mínimo, e diz os dois", () => {
    expect(DASH).toContain("semEstoque + noMinimo");
    expect(DASH).toContain("no mínimo, com saldo");
  });
  it("retrabalho e perdas: sem registro não diz 'sem retrabalho' em verde", () => {
    expect(DASH).toContain("Retrabalho e perdas");
    expect(DASH).not.toContain('label="Sem retrabalho"');
    expect(DASH).toContain("Nada registrado");
    expect(DASH).toContain("os_perdas");
  });
});
