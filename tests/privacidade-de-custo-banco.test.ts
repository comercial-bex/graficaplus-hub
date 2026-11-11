import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Privacidade do custo, onda A (10/11/2026).
 *
 * Quem só é da equipe (vendedor, operador, designer) lia, direto do banco, o salário e o custo/hora de cada função,
 * os parâmetros de custo da casa, o patrimônio das máquinas e o custo da produtividade 3D, embora as telas
 * escondessem. A migração fecha isso sem mexer em tela. O comportamento foi ensaiado no banco vivo com as contas
 * reais, antes e depois, em transação desfeita; estes testes conferem o TEXTO da migração para que uma edição
 * futura não desfaça as guardas.
 */

const SQL = readFileSync(
  "supabase/migrations/20261110210000_custo_privado_a_sem_mexer_em_tela.sql",
  "utf8",
);
const CODIGO = SQL.replace(/^--[^\n]*$/gm, "");

describe("as duas réguas de quem vê custo", () => {
  it("pode_ver_custo: custos.read, financeiro.read ou impressao3d.cost.read (inclui o estoque)", () => {
    expect(CODIGO).toContain("CREATE OR REPLACE FUNCTION public.pode_ver_custo(_user_id uuid)");
    expect(CODIGO).toContain("SELECT public.has_permission(_user_id, 'custos.read')");
    expect(CODIGO).toContain("OR public.has_permission(_user_id, 'impressao3d.cost.read')");
  });

  it("pode_ver_custo_de_maquina: só financeiro.read ou impressao3d.cost.read (o estoque fica de fora)", () => {
    const inicio = CODIGO.indexOf("CREATE OR REPLACE FUNCTION public.pode_ver_custo_de_maquina");
    const corpo = CODIGO.slice(inicio, CODIGO.indexOf("$function$;", inicio));
    expect(corpo).toContain("has_permission(_user_id, 'financeiro.read')");
    expect(corpo).toContain("has_permission(_user_id, 'impressao3d.cost.read')");
    expect(corpo).not.toContain("custos.read");
  });

  it("as duas fecham o visitante e a regra de público, e abrem só para quem entra", () => {
    for (const f of ["pode_ver_custo", "pode_ver_custo_de_maquina"]) {
      expect(CODIGO).toContain(`REVOKE ALL ON FUNCTION public.${f}(uuid) FROM PUBLIC, anon;`);
      expect(CODIGO).toContain(
        `GRANT EXECUTE ON FUNCTION public.${f}(uuid) TO authenticated, service_role;`,
      );
    }
  });

  it("as duas réguas e a produtividade 3D são SECURITY DEFINER com search_path fixo", () => {
    expect(CODIGO.match(/STABLE\s+SECURITY DEFINER\s+SET search_path TO 'public'/g)).toHaveLength(
      3,
    );
  });
});

describe("mão de obra e parâmetros: só quem vê custo (o estoque continua)", () => {
  it("a leitura de custos_mao_de_obra troca a policy da equipe pela de custo", () => {
    expect(CODIGO).toContain(
      "DROP POLICY IF EXISTS custos_mao_de_obra_leitura_equipe ON public.custos_mao_de_obra;",
    );
    expect(CODIGO).toMatch(
      /CREATE POLICY custos_mao_de_obra_leitura_custo ON public\.custos_mao_de_obra\s+FOR SELECT TO authenticated\s+USING \(public\.pode_ver_custo\(\(SELECT auth\.uid\(\)\)\)\);/,
    );
  });

  it("custos_tabela: a equipe lê só a categoria 'chave' (prazo padrão e converter sozinho); o resto, só quem vê custo", () => {
    expect(CODIGO).toContain(
      "DROP POLICY IF EXISTS custos_tabela_leitura_equipe ON public.custos_tabela;",
    );
    expect(CODIGO).toContain("USING (public.is_staff((SELECT auth.uid()))");
    expect(CODIGO).toContain(
      "AND (categoria = 'chave' OR public.pode_ver_custo((SELECT auth.uid()))));",
    );
  });

  it("o histórico dos parâmetros é só de quem vê custo", () => {
    expect(CODIGO).toMatch(
      /CREATE POLICY custos_hist_leitura ON public\.custos_tabela_historico\s+FOR SELECT TO authenticated\s+USING \(public\.pode_ver_custo\(\(SELECT auth\.uid\(\)\)\)\);/,
    );
  });

  it("não toca nenhuma policy de escrita dessas tabelas", () => {
    expect(CODIGO).not.toMatch(/ON public\.custos_mao_de_obra\s+FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(CODIGO).not.toMatch(/ON public\.custos_tabela\s+FOR (INSERT|UPDATE|DELETE|ALL)/);
  });
});

describe("máquinas e 3D: só quem vê custo de máquina", () => {
  it("o patrimônio das máquinas só devolve linhas a quem vê custo de máquina e volta a security_invoker", () => {
    expect(CODIGO).toContain("WHERE public.pode_ver_custo_de_maquina(auth.uid())");
    expect(CODIGO).toContain(
      "ALTER VIEW public.vw_patrimonio_maquinas SET (security_invoker = true);",
    );
    expect(CODIGO).toContain(
      "REVOKE ALL ON public.vw_patrimonio_maquinas FROM PUBLIC, anon, authenticated;",
    );
    expect(CODIGO).toContain("GRANT SELECT ON public.vw_patrimonio_maquinas TO authenticated;");
  });

  it("a produtividade 3D devolve horas, peças e falhas a quem tem impressao3d.read e custo só a quem vê custo de máquina", () => {
    expect(CODIGO).toContain("public.pode_ver_custo_de_maquina(auth.uid())) as custo)");
    expect(CODIGO.match(/case when ve\.custo then/g)?.length).toBeGreaterThanOrEqual(5);
    expect(CODIGO).toContain("where public.has_permission(auth.uid(), 'impressao3d.reports.read')");
    expect(CODIGO).toContain("or public.has_permission(auth.uid(), 'impressao3d.read')");
  });

  it("a sugestão de custo/hora (a conta do contrato) passa a exigir financeiro.read", () => {
    expect(CODIGO).toContain("v_ancora constant text := 'require_permission(''maquinas.read'')';");
    expect(CODIGO).toContain("replace(v_def, v_ancora, 'require_permission(''financeiro.read'')')");
  });

  it("o evento de custo/hora manual 3D só é lido por quem vê custo de máquina", () => {
    expect(CODIGO).toContain(
      "AND (entidade <> 'maquinas_3d_config' OR public.pode_ver_custo_de_maquina((SELECT auth.uid())))",
    );
  });

  it("a policy ALL de gravar serviço 3D deixa de abrir a leitura: gravar é quote.update, ler é impressao3d.cost.read", () => {
    expect(CODIGO).toContain(
      "DROP POLICY IF EXISTS impressao3d_servicos_manage ON public.orcamento_3d_servicos;",
    );
    expect(CODIGO).toMatch(
      /CREATE POLICY impressao3d_servicos_leitura_custo[\s\S]*?'impressao3d\.cost\.read'/,
    );
    expect(CODIGO).toContain("FOR INSERT TO authenticated");
    expect(CODIGO).toContain("FOR UPDATE TO authenticated");
    expect(CODIGO).toContain("FOR DELETE TO authenticated");
    expect(CODIGO).not.toMatch(/CREATE POLICY[^;]*FOR ALL/);
  });
});

describe("as trocas sobre objeto vivo param em voz alta", () => {
  it("função e visão vivas só são trocadas se o md5 ou a âncora conferem", () => {
    expect(CODIGO).toContain("IF md5(v_def) <> 'b2fc940e6aa7c8f92a10546841154d78' THEN");
    expect(CODIGO).toContain("ELSIF md5(v_def) <> '35136f0f94ed0bec3a64ef1cac5fbaad' THEN");
    expect(CODIGO).toContain("ELSIF md5(v_qual) <> 'b09477ce224340888306bda561add2d9' THEN");
    expect(CODIGO).toContain("IF v_n <> 1 THEN");
    expect(CODIGO.match(/RAISE EXCEPTION/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it("rodar de novo é inofensivo: cada troca reconhece que já foi feita", () => {
    expect(CODIGO).toContain("custo_hora_sugerido já exige financeiro.read");
    expect(CODIGO).toContain("produtividade_3d já esconde o custo");
    expect(CODIGO).toContain("vw_patrimonio_maquinas já tem a guarda");
    expect(CODIGO).toContain("eventos_negocio já trava o evento de custo/hora manual");
  });
});

describe("o visitante (anon) não lê nem grava nas tabelas de custo", () => {
  const TABELAS = [
    "custos_mao_de_obra",
    "custos_tabela",
    "custos_tabela_historico",
    "config_precificacao_3d",
    "materiais_3d_filamento",
    "maquinas_3d_config",
    "maquinas_contrato",
    "producao_3d_jobs",
    "orcamento_3d_servicos",
    "orcamento_3d_calculos",
    "orcamento_3d_consumos",
  ];

  it("revoga o privilégio de tabela do anon nas 11 tabelas (REVOKE de PUBLIC não fecha o anon)", () => {
    const bloco = CODIGO.slice(
      CODIGO.indexOf("REVOKE ALL ON public.custos_mao_de_obra"),
      CODIGO.indexOf("FROM anon;"),
    );
    for (const t of TABELAS) expect(bloco, t).toContain(`public.${t}`);
    expect(CODIGO).toContain("FROM anon;");
  });

  it("não revoga nada de authenticated nessas tabelas (a RLS é quem decide)", () => {
    const bloco = CODIGO.slice(
      CODIGO.indexOf("REVOKE ALL ON public.custos_mao_de_obra"),
      CODIGO.indexOf("FROM anon;") + 10,
    );
    expect(bloco).not.toContain("authenticated");
  });
});
