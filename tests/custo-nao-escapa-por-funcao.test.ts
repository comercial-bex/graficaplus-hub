import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * O custo não escapa por função (04/11/2026, revisão adversarial do PR 425).
 *
 * Função SECURITY DEFINER passa por cima de GRANT por coluna, RLS e views por nível: o que ela
 * devolve ou grava vale para quem a chama. A revisão achou seis portas por onde o vendedor, o
 * operador e até o parceiro liam custo; a conta real de um vendedor (sem financeiro.read,
 * custos.read nem estoque.cost.read) lia 4 eventos com custo, margem e lucro de OS fechadas e
 * recebia custo e fornecedor de material pela sugestão de compra.
 *
 * Estes testes conferem o TEXTO da migração e da tela (o comportamento foi ensaiado no banco
 * vivo, antes e depois, em transação desfeita): se alguém trocar a regra, o teste avisa.
 */

const migracao = readFileSync("supabase/migrations/20261104100000_custo_nao_escapa_por_funcao.sql", "utf8");
const cartao = readFileSync("src/components/materiais-previstos-card.tsx", "utf8");

describe("os ajudantes que tiram o custo", () => {
  it("jsonb_sem_custo tira toda chave de custo, margem, lucro, markup e divergência de custo", () => {
    expect(migracao).toContain("CREATE OR REPLACE FUNCTION public.jsonb_sem_custo(p_json jsonb)");
    expect(migracao).toContain("k ~* '(custo|margem|lucro|markup|divergencia)'");
    expect(migracao).toContain("REVOKE ALL ON FUNCTION public.jsonb_sem_custo(jsonb) FROM PUBLIC, anon, authenticated;");
  });

  it("estimativas_sem_reais tira o '(R$ 0,00)' dos textos do fechamento", () => {
    expect(migracao).toContain("CREATE OR REPLACE FUNCTION public.estimativas_sem_reais(p_estimativas jsonb)");
    expect(migracao).toContain(String.raw`'\s*\(R\$\s*[0-9.,]+\)'`);
    expect(migracao).toContain("REVOKE ALL ON FUNCTION public.estimativas_sem_reais(jsonb) FROM PUBLIC, anon, authenticated;");
  });

  it("os_sem_colunas_privadas tira o que o próprio banco não deixa authenticated ler, menos para o financeiro", () => {
    expect(migracao).toContain("CREATE OR REPLACE FUNCTION public.os_sem_colunas_privadas(p_os public.ordens_servico)");
    expect(migracao).toContain("IF public.can_see_financials(auth.uid()) THEN RETURN p_os; END IF;");
    expect(migracao).toContain("NOT has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')");
    expect(migracao).toContain("jsonb_populate_record(NULL::public.ordens_servico, to_jsonb(p_os) - v_privadas)");
    expect(migracao).toContain("REVOKE ALL ON FUNCTION public.os_sem_colunas_privadas(public.ordens_servico) FROM PUBLIC, anon, authenticated;");
  });
});

describe("sugestão de compra", () => {
  it("só a equipe chama, e custo e fornecedor só voltam para quem vê custo de material", () => {
    expect(migracao).toContain("CREATE OR REPLACE FUNCTION public.sugerir_compra_da_os(p_os_id uuid)");
    expect(migracao).toContain("CASE WHEN v.ve_custo THEN coalesce(m.custo_unitario, m.custo_medio, 0) END");
    expect(migracao).toContain("CASE WHEN v.ve_custo THEN m.fornecedor END");
    expect(migracao).toContain("public.has_permission(auth.uid(), 'estoque.cost.read') or public.can_see_financials(auth.uid())");
    expect(migracao).toContain("and public.is_staff(auth.uid())");
  });

  it("a tela aceita custo nulo e grava zero (a coluna é NOT NULL): o comprador preenche em Compras", () => {
    expect(cartao).toContain("ultimo_custo: number | null;");
    expect(cartao).toContain("custo_unitario: i.ultimo_custo ?? 0,");
  });
});

describe("avancar_os_status e fechar_os", () => {
  it("avancar_os_status devolve a linha da OS sem as colunas privadas nas três saídas", () => {
    expect(migracao).toContain("pg_get_functiondef('public.avancar_os_status(uuid,public.status_os)'::regprocedure)");
    expect(migracao).toContain("'RETURN v_os_atualizada;', 'RETURN public.os_sem_colunas_privadas(v_os_atualizada);'");
    expect(migracao).toContain("'RETURN v_os;', 'RETURN public.os_sem_colunas_privadas(v_os);'");
    expect(migracao).toContain("IF n <> 3 THEN");
  });

  it("fechar_os: o texto sai sem reais depois do snapshot, o evento e a resposta sem chaves de custo", () => {
    expect(migracao).toContain("pg_get_functiondef('public.fechar_os(uuid)'::regprocedure)");
    expect(migracao).toContain("v_estimativas := public.estimativas_sem_reais(v_estimativas);");
    expect(migracao).toContain("NULL, public.jsonb_sem_custo(v_result) || jsonb_build_object('estimativas', v_estimativas));");
    expect(migracao).toContain("CASE WHEN public.can_see_financials(v_uid) THEN v_result ELSE public.jsonb_sem_custo(v_result) END");
    // O texto sem reais entra DEPOIS do snapshot, que guarda o texto com valor (protegido por resultado.read).
    const sobreSnapshot = migracao.indexOf("O snapshot acima guarda o texto das estimativas com valor");
    expect(sobreSnapshot).toBeGreaterThan(0);
  });
});

describe("aprovar_orcamento, converter_orcamento_em_os e o retrato da versão", () => {
  it("aprovar_orcamento grava a versão que cria sem custo, token nem IP", () => {
    expect(migracao).toContain("pg_get_functiondef('public.aprovar_orcamento(uuid,uuid,text)'::regprocedure)");
    expect(migracao).toContain("public.jsonb_sem_custo(to_jsonb(v_orc) - 'token_publico' - 'aprovado_ip')");
  });

  it("converter_orcamento_em_os só devolve o custo previsto de material a quem vê o financeiro", () => {
    expect(migracao).toContain("pg_get_functiondef('public.converter_orcamento_em_os(uuid,jsonb)'::regprocedure)");
    expect(migracao).toContain("CASE WHEN public.can_see_financials(auth.uid()) THEN v_custo_materiais END");
  });

  it("o retrato cobre custo, margem, lucro e markup nos itens e usa o mesmo filtro no cabeçalho", () => {
    expect(migracao).toContain("'^(custos?|margem|lucro|markup|divergencia)(_|$)'");
    expect(migracao).toContain("public.jsonb_sem_custo(to_jsonb(NEW) - 'token_publico' - 'aprovado_ip')");
    expect(migracao).toContain("REVOKE ALL ON FUNCTION public.orcamento_itens_para_versao(uuid) FROM PUBLIC, anon, authenticated;");
    expect(migracao).toContain("REVOKE ALL ON FUNCTION public.tg_orcamento_congela_versao() FROM PUBLIC, anon, authenticated;");
  });
});

describe("cada troca é feita sobre a definição viva e para em voz alta se ela mudou", () => {
  it("toda troca confere a âncora antes de executar, e rodar de novo é inofensivo", () => {
    const blocos = migracao.split("DO $m$").length - 1;
    expect(blocos).toBeGreaterThanOrEqual(5);
    expect(migracao.match(/RAISE EXCEPTION '[a-z_]+: /g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(migracao.match(/RAISE NOTICE '[^']*já /g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });
});
