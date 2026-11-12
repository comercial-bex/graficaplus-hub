import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO,
  COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D,
  COLUNAS_DE_CUSTO_DO_FILAMENTO,
  COLUNAS_DO_FILAMENTO_SEM_CUSTO,
} from "../src/domain/impressao3d/colunas";

/**
 * Privacidade do custo, onda C (11/11/2026): as taxas da impressão 3D.
 *
 * C1 cria as visões que quem vê custo passa a ler (aditiva); C3 tira da equipe a leitura das colunas de custo da
 * impressora e do filamento e da linha da base de preço. Estes testes conferem o TEXTO das migrações, para que uma
 * edição futura não desfaça as guardas nem desalinhe o GRANT da lista que o front usa. O efeito no banco é do ensaio
 * (transação desfeita, contas reais) de quem aplica.
 */

const sem = (sql: string) => sql.replace(/^--[^\n]*$/gm, "");
const C1 = sem(
  readFileSync(
    "supabase/migrations/20261110270000_custo_privado_c1_visoes_do_custo_3d.sql",
    "utf8",
  ),
);
const C3 = sem(
  readFileSync("supabase/migrations/20261110280000_custo_privado_c3_fechar_taxas_3d.sql", "utf8"),
);

/** As colunas da lista de um GRANT por coluna. */
function grant(sql: string, tabela: string): string[] {
  const m = sql.match(
    new RegExp(`GRANT SELECT \\(([^)]*)\\)\\s+ON public\\.${tabela} TO authenticated;`),
  );
  expect(m, `GRANT por coluna em ${tabela}`).not.toBeNull();
  return m![1].split(",").map((x) => x.trim());
}

/** As colunas de um ARRAY['a', 'b'] atribuído a uma variável da guarda. */
function arrayDaGuarda(sql: string, variavel: string): string[] {
  const m = sql.match(new RegExp(`${variavel} constant text\\[\\] := ARRAY\\[([^\\]]*)\\]`));
  expect(m, variavel).not.toBeNull();
  return [...m![1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
}

describe("onda C1: as visões do custo da impressão 3D", () => {
  it("as duas visões guardam no WHERE: só quem é da equipe e vê custo de máquina", () => {
    for (const v of ["maquinas_3d_config_financeiro", "materiais_3d_filamento_financeiro"]) {
      const inicio = C1.indexOf(`CREATE OR REPLACE VIEW public.${v} AS`);
      expect(inicio, v).toBeGreaterThan(0);
      const corpo = C1.slice(inicio, C1.indexOf(";", inicio));
      expect(corpo).toContain(
        "WHERE public.is_staff(( SELECT auth.uid() AS uid)) AND public.pode_ver_custo_de_maquina(( SELECT auth.uid() AS uid))",
      );
    }
  });

  it("security_barrier ligado, security_invoker desligado, só SELECT para authenticated, nada para o visitante", () => {
    for (const v of ["maquinas_3d_config_financeiro", "materiais_3d_filamento_financeiro"]) {
      expect(C1).toContain(
        `ALTER VIEW public.${v} SET (security_invoker = false, security_barrier = true);`,
      );
      expect(C1).toContain(`REVOKE ALL ON public.${v} FROM PUBLIC, anon, authenticated;`);
      expect(C1).toContain(`GRANT SELECT ON public.${v} TO authenticated;`);
      expect(C1).not.toMatch(new RegExp(`GRANT\\s+(INSERT|UPDATE|DELETE|ALL)[^;]*${v}`, "i"));
      // as opções vêm DEPOIS da criação (CREATE OR REPLACE VIEW as zera)
      expect(C1.indexOf(`ALTER VIEW public.${v}`)).toBeGreaterThan(
        C1.indexOf(`CREATE OR REPLACE VIEW public.${v}`),
      );
    }
  });

  it("a visão da impressora traz TODAS as colunas da tabela (aberta e de custo), mais nome e tipo da máquina", () => {
    const inicio = C1.indexOf("CREATE OR REPLACE VIEW public.maquinas_3d_config_financeiro");
    const corpo = C1.slice(inicio, C1.indexOf("FROM public.maquinas_3d_config c", inicio));
    const cols = [...corpo.matchAll(/\bc\.(\w+)/g)].map((m) => m[1]);
    expect([...cols].sort()).toEqual(
      [...COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO, ...COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D].sort(),
    );
    expect(corpo).toContain("m.nome");
    expect(corpo).toContain("m.tipo");
  });

  it("a visão do filamento traz TODAS as colunas da tabela, mais o nome do material", () => {
    const inicio = C1.indexOf("CREATE OR REPLACE VIEW public.materiais_3d_filamento_financeiro");
    const corpo = C1.slice(inicio, C1.indexOf("FROM public.materiais_3d_filamento f", inicio));
    const cols = [...corpo.matchAll(/\bf\.(\w+)/g)].map((m) => m[1]);
    expect([...cols].sort()).toEqual(
      [...COLUNAS_DO_FILAMENTO_SEM_CUSTO, ...COLUNAS_DE_CUSTO_DO_FILAMENTO].sort(),
    );
    expect(corpo).toContain("mt.nome");
  });

  it("para antes de criar se a tabela ganhou ou perdeu coluna desde a leitura de 11/11", () => {
    expect([...arrayDaGuarda(C1, "v_imp_esperadas")].sort()).toEqual(
      [...COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO, ...COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D].sort(),
    );
    expect([...arrayDaGuarda(C1, "v_fil_esperadas")].sort()).toEqual(
      [...COLUNAS_DO_FILAMENTO_SEM_CUSTO, ...COLUNAS_DE_CUSTO_DO_FILAMENTO].sort(),
    );
    expect(C1).toContain("RAISE EXCEPTION 'C1: public.% mudou desde a leitura de 11/11/2026");
    expect(C1.indexOf("DO $guarda$")).toBeLessThan(C1.indexOf("CREATE OR REPLACE VIEW"));
  });

  it("é aditiva: não revoga nem apaga nada de nenhuma tabela, nem mexe em policy", () => {
    expect(C1).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bPOLICY\b/i);
    expect(C1).not.toMatch(
      /REVOKE[^;]*ON\s+public\.(maquinas_3d_config|materiais_3d_filamento|config_precificacao_3d)\s/i,
    );
  });
});

describe("onda C3: o fechamento das taxas da impressão 3D", () => {
  it("a leitura que sobra para authenticated é exatamente a lista aberta do código, nas duas tabelas", () => {
    expect([...grant(C3, "maquinas_3d_config")].sort()).toEqual(
      [...COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO].sort(),
    );
    expect([...grant(C3, "materiais_3d_filamento")].sort()).toEqual(
      [...COLUNAS_DO_FILAMENTO_SEM_CUSTO].sort(),
    );
  });

  it("tira o SELECT de tabela inteira de authenticated e do visitante, e não revoga escrita de ninguém", () => {
    expect(C3).toContain("REVOKE SELECT ON public.maquinas_3d_config FROM authenticated, anon;");
    expect(C3).toContain(
      "REVOKE SELECT ON public.materiais_3d_filamento FROM authenticated, anon;",
    );
    expect(C3).not.toMatch(
      /REVOKE\s+(ALL|INSERT|UPDATE|DELETE)[^;]*ON public\.(maquinas_3d_config|materiais_3d_filamento|config_precificacao_3d)\b/i,
    );
    expect(C3).not.toMatch(/service_role/);
  });

  it("as listas da guarda são as listas do código (aberta e de custo)", () => {
    expect(arrayDaGuarda(C3, "v_imp_abertas")).toEqual([...COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO]);
    expect(arrayDaGuarda(C3, "v_imp_custo")).toEqual([...COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D]);
    expect(arrayDaGuarda(C3, "v_fil_abertas")).toEqual([...COLUNAS_DO_FILAMENTO_SEM_CUSTO]);
    expect(arrayDaGuarda(C3, "v_fil_custo")).toEqual([...COLUNAS_DE_CUSTO_DO_FILAMENTO]);
  });

  it("para antes de fechar: coluna nova, C1 ausente, visão invoker, função invoker ou policy que leia as tabelas", () => {
    const guarda = C3.slice(C3.indexOf("DO $guarda$"), C3.indexOf("END $guarda$;"));
    expect(guarda).toContain("RAISE EXCEPTION 'C3: public.% mudou desde a leitura de 11/11/2026");
    expect(guarda).toContain("to_regclass('public.maquinas_3d_config_financeiro') IS NULL");
    expect(guarda).toContain("to_regclass('public.materiais_3d_filamento_financeiro') IS NULL");
    expect(guarda).toContain("coalesce(c.reloptions::text, '') ~ 'security_invoker=(true|on)'");
    expect(guarda).toContain("NOT p.prosecdef");
    expect(guarda).toContain("FROM pg_policies");
    expect(guarda.match(/RAISE EXCEPTION/g)!.length).toBeGreaterThanOrEqual(6);
    // as guardas vêm antes de qualquer REVOKE ou troca de policy
    const fecha = C3.indexOf("REVOKE SELECT ON public.maquinas_3d_config");
    expect(C3.indexOf("DO $guarda$")).toBeGreaterThan(-1);
    expect(fecha).toBeGreaterThan(C3.indexOf("END $guarda$;"));
  });

  it("a base de preço só para quem vê custo de máquina; a leitura antiga sai só se for a de 05/11 (md5)", () => {
    expect(C3).toContain("md5(coalesce(v_qual, '')) <> '6bbc721ca2536e19eeeed3f8b38300bd'");
    expect(C3).toContain('DROP POLICY "config 3d read" ON public.config_precificacao_3d;');
    expect(C3).toMatch(
      /CREATE POLICY config_3d_leitura_custo ON public\.config_precificacao_3d\s+FOR SELECT TO authenticated\s+USING \(public\.pode_ver_custo_de_maquina\(\(SELECT auth\.uid\(\)\)\)\);/,
    );
  });

  it("a policy de gravar passa a filtrar na leitura, conferida por md5 no USING e no WITH CHECK, e reconhece a troca feita", () => {
    expect(C3).toContain("md5(coalesce(v_check, '')) <> '5462ae4ca07991ead1dfbc7f2c50fee3'");
    expect(C3).toContain("md5(coalesce(v_qual, '')) <> '5462ae4ca07991ead1dfbc7f2c50fee3'");
    expect(C3).toContain(
      "USING (public.has_permission((SELECT auth.uid()), 'impressao3d.settings.manage'));",
    );
    expect(C3).toContain("já filtra na leitura");
    expect(C3).toContain("já saiu");
    // a escrita continua lançando: o WITH CHECK não é trocado
    expect(C3).not.toMatch(/ALTER POLICY "config 3d manage"[^;]*WITH CHECK/);
  });

  it("não toca policy nem GRANT de escrita das duas tabelas de impressora e filamento", () => {
    expect(C3).not.toMatch(/POLICY[^;]*ON public\.(maquinas_3d_config|materiais_3d_filamento)\b/);
    expect(C3).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)/i);
  });
});

describe("as duas migrações", () => {
  it("prefixos únicos, sem CURRENT_DATE, recarregam o PostgREST e dizem que ainda não foram aplicadas", () => {
    for (const [nome, sql] of [
      ["20261110270000_custo_privado_c1_visoes_do_custo_3d.sql", C1],
      ["20261110280000_custo_privado_c3_fechar_taxas_3d.sql", C3],
    ] as const) {
      const bruto = readFileSync(`supabase/migrations/${nome}`, "utf8");
      expect(bruto.split("\n")[0], nome).toMatch(/^-- AINDA NÃO APLICADA/);
      expect(sql).not.toMatch(/current_date/i);
      expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
    }
  });
});
