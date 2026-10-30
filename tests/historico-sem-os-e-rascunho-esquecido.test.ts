import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESUMO_POR_ROTULO } from "../src/domain/painel/resumo-do-dia";

/**
 * Diagnóstico final de 29/10/2026, verificações 3.1 e 2.2 da operação.
 *
 * 3.1 — a decisão (b) do dono ("cinco orçamentos impressos sem virar OS: manter como histórico") ficou registrada e o
 * efeito não: os cinco seguiam "aprovados sem OS", no aviso crítico e na mensagem diária que o gestor recebe. Agora
 * `orcamentos.sem_os_motivo` os tira dos dois (ensaio: 7 para 2, sobram o 142 que espera o Pix e o 153 que espera o
 * custo dos itens).
 *
 * 2.2 — nenhum aviso olhava rascunho: 7 de 8 tinham mais de 14 dias, R$ 5.606,49 parados (ensaio: o aviso novo
 * devolve exatamente 7 de 8 e esse valor).
 */
const PASTA = join(__dirname, "..", "supabase/migrations");
const SQL = readFileSync(
  join(PASTA, "20261030860000_orcamento_historico_sem_os_e_rascunho_esquecido.sql"),
  "utf8",
);
const DECISAO = readFileSync(join(PASTA, "20261030870000_decisao_fechamento_da_os.sql"), "utf8");

describe("orçamento histórico, sem OS por decisão do dono", () => {
  it("a coluna nova só tira do aviso e do lembrete; o status e o dinheiro não são mexidos", () => {
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS sem_os_motivo text");
    expect(SQL).toContain("AND o.sem_os_motivo IS NULL");
    expect(SQL).toContain("AND os_id IS NULL AND sem_os_motivo IS NULL HAVING count(*) > 0;");
    expect(SQL).not.toMatch(/UPDATE\s+public\.orcamentos\s+SET\s+status/i);
    expect(SQL).not.toMatch(
      /INSERT\s+INTO\s+public\.(pagamentos|parcelas_receber|ordens_servico)/i,
    );
  });

  it("marca só os cinco da decisão, e só se ainda forem aprovados e sem OS", () => {
    expect(SQL).toContain(
      "numero IN (54, 56, 57, 62, 70) AND status = 'aprovado' AND os_id IS NULL",
    );
    expect(SQL).not.toContain("142");
    expect(SQL).not.toContain("153");
  });

  it("dá para desfazer: limpar a coluna", () => {
    expect(SQL).toContain("Limpar a coluna desfaz");
  });
});

describe("o aviso do rascunho esquecido", () => {
  it("existe, olha rascunho com mais de 14 dias, diz o valor parado e vai para o atendimento", () => {
    expect(SQL).toContain("'orcamento_rascunho_esquecido'");
    expect(SQL).toContain("o.status = 'rascunho' AND o.created_at < now() - interval '14 days'");
    expect(SQL).toContain("public._reais(sum(coalesce(o.valor_total, 0)))");
    expect(SQL).toContain("'atencao', 'atendimento'");
  });

  it("aparece no resumo do dia do atendimento", () => {
    expect(RESUMO_POR_ROTULO.atendimento.map((x) => x.chave)).toContain(
      "orcamento_rascunho_esquecido",
    );
  });

  it("é seguro de reaplicar e para se a âncora mudou", () => {
    expect(SQL).toContain("IF position('orcamento_rascunho_esquecido' IN v_def) = 0 THEN");
    expect(SQL.match(/RAISE EXCEPTION '[^']*esperava 1 âncora/g)).toHaveLength(3);
  });
});

describe("a decisão do fechamento da OS fica registrada", () => {
  it("nasce resolvida, com a resposta e como desfazer, e só uma vez", () => {
    expect(DECISAO).toContain("'fechamento_da_os'");
    expect(DECISAO).toContain("now(), now()");
    expect(DECISAO).toContain("Para desfazer");
    expect(DECISAO).toContain(
      "WHERE NOT EXISTS (SELECT 1 FROM public.decisoes_pendentes WHERE chave = 'fechamento_da_os')",
    );
  });
});

describe("o aviso do orçamento enviado sem a condição de pagamento", () => {
  const AVISO = readFileSync(
    join(PASTA, "20261030880000_aviso_orcamento_enviado_sem_condicao.sql"),
    "utf8",
  );

  it("olha o enviado depois da regra de 29/10 que não traz forma e modelo válido", () => {
    expect(AVISO).toContain("'orcamento_enviado_sem_condicao'");
    expect(AVISO).toContain("o.status = 'enviado' AND o.created_at >= '2026-10-29'");
    expect(AVISO).toContain("IN ('a_vista', 'metade_metade', 'entrada', 'parcelado')");
  });

  it("é aviso, não trava: o orçamento sai por mais de uma porta e o dono não decidiu barrar o envio no banco", () => {
    expect(AVISO).not.toMatch(/CREATE\s+(OR REPLACE\s+)?TRIGGER/i);
    expect(AVISO).toContain("'atencao', 'atendimento'");
  });

  it("aparece no resumo do dia do atendimento e é seguro de reaplicar", () => {
    expect(RESUMO_POR_ROTULO.atendimento.map((x) => x.chave)).toContain(
      "orcamento_enviado_sem_condicao",
    );
    expect(AVISO).toContain("IF position('orcamento_enviado_sem_condicao' IN v_def) = 0 THEN");
  });
});
