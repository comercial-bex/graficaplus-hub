import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Diagnóstico final de 29/10/2026, verificações 9.5 e 9.7.
 *
 * 9.5 — quatro funções de gatilho tinham EXECUTE para o anônimo (o Supabase entrega EXECUTE a PUBLIC, anon
 * e authenticated em toda função nova, e o PostgREST publica como /rpc/ o que o anônimo executa). O gatilho
 * não precisa dessa permissão para disparar. A migração fecha todas e confere com has_function_privilege.
 *
 * 9.7 — `ordens_servico.status_arte` ficou 'pendente' em todas as OS e ninguém a lia. Saiu.
 */
const RAIZ = join(__dirname, "..");
const PASTA_MIGRACOES = join(RAIZ, "supabase/migrations");
const MIGRACAO = "20261030820000_gatilhos_fechados_e_coluna_morta.sql";
const SQL = readFileSync(join(PASTA_MIGRACOES, MIGRACAO), "utf8");

describe("funções de gatilho fechadas para o público", () => {
  it("fecha todas as funções de gatilho do schema public, não só as quatro que apareceram", () => {
    expect(SQL).toMatch(/p\.prorettype = 'trigger'::regtype/);
    expect(SQL).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated");
  });

  it("confere com has_function_privilege, porque o REVOKE não reclama", () => {
    expect(SQL).toContain("has_function_privilege('anon', p.oid, 'EXECUTE')");
    expect(SQL).toContain("has_function_privilege('authenticated', p.oid, 'EXECUTE')");
    expect(SQL).toContain("RAISE EXCEPTION 'função de gatilho ainda executável");
  });

  it("o quadro de bloqueios é da equipe: sai do anônimo e continua para quem está logado", () => {
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public.os_bloqueios_do_quadro() FROM PUBLIC, anon;",
    );
    expect(SQL).toContain(
      "GRANT EXECUTE ON FUNCTION public.os_bloqueios_do_quadro() TO authenticated, service_role;",
    );
  });
});

describe("a coluna morta status_arte", () => {
  it("só é removida se todos os valores forem o padrão", () => {
    expect(SQL).toContain(
      "status_arte IS DISTINCT FROM 'pendente' AND status_arte IS DISTINCT FROM 'nao_iniciada'",
    );
    expect(SQL).toContain("ALTER TABLE public.ordens_servico DROP COLUMN status_arte;");
  });

  it("nenhum código da tela volta a ler ou gravar a coluna", () => {
    const lerPasta = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const c = join(dir, n);
        if (statSync(c).isDirectory()) return lerPasta(c);
        return /\.(ts|tsx)$/.test(n) ? [c] : [];
      });
    const culpados = lerPasta(join(RAIZ, "src")).filter((f) =>
      /\bstatus_arte\b/.test(readFileSync(f, "utf8")),
    );
    expect(culpados.map((f) => f.replace(RAIZ + "/", ""))).toEqual([]);
  });
});

describe("função de gatilho nova já nasce fechada", () => {
  const depois = readdirSync(PASTA_MIGRACOES)
    .filter((f) => f.endsWith(".sql") && f.slice(0, 14) > MIGRACAO.slice(0, 14))
    .sort();

  it("toda migração posterior que cria função de gatilho a fecha no mesmo arquivo", () => {
    const falhas: string[] = [];
    for (const nome of depois) {
      const sql = readFileSync(join(PASTA_MIGRACOES, nome), "utf8");
      const criadas = [
        ...sql.matchAll(
          /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(\s*\)\s*RETURNS\s+trigger/gi,
        ),
      ].map((m) => m[1]);
      for (const funcao of criadas) {
        const fecha = new RegExp(
          `REVOKE\\s+(?:ALL|EXECUTE)\\s+ON\\s+FUNCTION\\s+public\\.${funcao}\\s*\\(\\s*\\)\\s+FROM[^;]*\\banon\\b`,
          "i",
        );
        if (!fecha.test(sql)) falhas.push(`${nome}: ${funcao}`);
      }
    }
    expect(
      falhas,
      "função de gatilho sem REVOKE ... FROM PUBLIC, anon, authenticated no mesmo arquivo",
    ).toEqual([]);
  });
});
