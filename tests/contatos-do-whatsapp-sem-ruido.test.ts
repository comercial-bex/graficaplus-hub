import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESUMO_POR_ROTULO } from "../src/domain/painel/resumo-do-dia";

/**
 * Contatos do WhatsApp sem ruído (diagnóstico final de 29/10/2026, verificações 1.1 e 1.2).
 *
 * A medição olhou o REGISTRO do lead, parado em 'novo' para todo mundo, e concluiu que ninguém atendia. Na
 * conversa, 9 de 14 contatos de verdade já tinham resposta humana e responsável: o trabalho acontece na caixa
 * do WhatsApp e o lead nunca era atualizado. Seis leads eram o telefone da própria equipe (o atendimento já
 * ignorava esse telefone desde 21/10, mas a criação de lead não) e cinco já eram clientes cadastrados.
 * A migração faz o lead acompanhar o atendimento e fecha os dois ruídos, sem apagar nada.
 */
const SQL = readFileSync(
  join(__dirname, "..", "supabase/migrations/20261030830000_contatos_do_whatsapp_sem_ruido.sql"),
  "utf8",
);

describe("telefone da equipe não vira lead", () => {
  it("a criação de lead passa a perguntar se o telefone é da equipe", () => {
    expect(SQL).toContain("AND NOT public._wa_telefone_da_equipe(v_tel) THEN");
    expect(SQL).toContain("p.proname = 'whatsapp_registrar_mensagem'");
  });

  it("o lead que já existia vira 'perdido' com o motivo, em vez de ser apagado", () => {
    expect(SQL).toContain("'Telefone da equipe: não é cliente novo'");
    expect(SQL).not.toMatch(/DELETE\s+FROM\s+public\.leads/i);
    expect(SQL).toContain("public._wa_telefone_da_equipe(l.telefone_normalizado)");
  });
});

describe("o lead acompanha o atendimento", () => {
  it("a primeira resposta humana passa o lead para em_atendimento e grava quem respondeu", () => {
    expect(SQL).toContain("p.proname = '_wa_mensagem_antes_inserir'");
    expect(SQL).toContain("WHEN status = 'novo' THEN 'em_atendimento'");
    expect(SQL).toContain("responsavel_id = coalesce(responsavel_id, NEW.enviada_por)");
  });

  it("lead ganho ou perdido não é mexido pela resposta", () => {
    expect(SQL).toContain("WHERE id = c.lead_id AND status NOT IN ('ganho', 'perdido')");
  });

  it("a resposta automática e a de IA não contam (só humano e celular)", () => {
    expect(SQL).toContain("coalesce(m.origem, 'humano') IN ('humano', 'celular')");
    // a troca é feita antes do ramo da IA, dentro do ramo humano
    expect(SQL).toContain("ELSIF NEW.origem = 'ia' THEN");
  });

  it("os leads que já estavam sendo atendidos andam, com o responsável que mais respondeu", () => {
    expect(SQL).toContain("ORDER BY count(*) DESC, max(m.enviado_em) DESC LIMIT 1");
  });
});

describe("quem já é cliente", () => {
  it("o lead liga ao cliente e fecha como ganho, só quando há um cliente ativo só", () => {
    expect(SQL).toContain("a.n = 1");
    expect(SQL).toContain("status = 'ganho', etapa = 'ganho'");
  });

  it("a conversa de cliente cadastrado ganha o vínculo", () => {
    expect(SQL).toContain("UPDATE public.whatsapp_conversas cv SET cliente_id = a.cliente_id");
  });
});

describe("o aviso do contato encerrado sem resposta", () => {
  it("existe no banco, vai para o atendimento e aparece no resumo do dia", () => {
    expect(SQL).toContain("'whatsapp_encerrado_sem_resposta'");
    expect(SQL).toContain("'atencao', 'atendimento'");
    const chaves = RESUMO_POR_ROTULO.atendimento.map((x) => x.chave);
    expect(chaves).toContain("whatsapp_encerrado_sem_resposta");
  });

  it("não conta o telefone da equipe, a automação nem o lead que já foi decidido", () => {
    expect(SQL).toContain("AND NOT public._wa_telefone_da_equipe(c.telefone_normalizado)");
    expect(SQL).toContain("coalesce(m.origem, 'humano') <> 'automacao'");
    expect(SQL).toContain("l.status IN ('ganho', 'perdido')");
  });

  it("só olha os últimos 30 dias", () => {
    expect(SQL).toContain("u.ultima > now() - interval '30 days'");
  });
});

describe("a migração é segura de reaplicar", () => {
  it("só troca a função se a troca ainda não está lá, e para se a âncora mudou", () => {
    expect(SQL).toContain(
      "IF position('NOT public._wa_telefone_da_equipe(v_tel)' IN v_def) = 0 THEN",
    );
    expect(SQL).toContain("IF position('c.lead_id IS NOT NULL' IN v_def) = 0 THEN");
    expect(SQL).toContain("IF position('whatsapp_encerrado_sem_resposta' IN v_def) = 0 THEN");
    expect(SQL.match(/RAISE EXCEPTION '[^']*esperava 1 âncora/g)).toHaveLength(3);
  });
});
