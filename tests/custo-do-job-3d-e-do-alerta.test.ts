import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Duas limpezas de custo que ficaram à vista da equipe (10/11/2026).
 *
 * A2: cada job de impressão 3D guardava o custo do material no retrato (custo_previsto_snapshot), legível por quem tem
 * impressao3d.read (vendedor e operador), sem nenhuma tela ler. O custo mora em orcamento_3d_consumos.
 *
 * O alerta de 28/10: a linha da fila de avisos com a auditoria de preços (28 valores em reais) era lida por toda a equipe.
 *
 * Os dois foram aplicados em produção; estes testes conferem o TEXTO das migrações para que uma edição futura não desfaça
 * as guardas.
 */

const A2 = readFileSync(
  "supabase/migrations/20261110230000_custo_privado_a2_retrato_do_job_3d.sql",
  "utf8",
);
const ALERTA = readFileSync(
  "supabase/migrations/20261110240000_custo_fora_do_alerta_de_28_10.sql",
  "utf8",
);
const codigo = (sql: string) => sql.replace(/^--[^\n]*$/gm, "");

describe("A2: o retrato do job 3D sem custo", () => {
  const c = codigo(A2);

  it("troca a função por âncora contada e para se sobrar chave de custo", () => {
    expect(c).toContain("IF n1 <> 1 OR n2 <> 1 THEN");
    expect(c).toContain("IF v_novo ~ '''custo_' THEN");
    expect(c).toContain("EXECUTE v_novo;");
  });

  it("tira as chaves dos jobs que existem, com o mesmo ajudante que o fechamento da OS usa", () => {
    expect(c).toContain("public.jsonb_sem_custo(j.custo_previsto_snapshot)");
    expect(c).toContain("public.jsonb_sem_custo(j.custo_real_snapshot)");
    expect(c.match(/\bUPDATE\s+public\.producao_3d_jobs\b/g)).toHaveLength(1);
  });

  it("trava com CHECK: o retrato não aceita chave com custo, margem, lucro ou markup", () => {
    expect(c).toContain("ADD CONSTRAINT producao_3d_jobs_snapshot_sem_custo_chk");
    expect(c).toContain("(custo|margem|lucro|markup)");
  });

  it("não apaga linha nem revoga leitura por coluna (os select('*') das telas continuam valendo)", () => {
    expect(c).not.toMatch(/\bDELETE\b/i);
    expect(c).not.toMatch(/\bREVOKE\b/i);
  });
});

describe("o alerta de 28/10 sem valores", () => {
  const c = codigo(ALERTA);

  it("só mexe na linha listada, e só se o texto vivo for o que foi listado", () => {
    expect(c).toContain("c_id constant uuid := 'fa5dae87-5fc4-472b-a079-18dace29c151';");
    expect(c).toMatch(/c_md5 constant text := '[0-9a-f]{32}';/);
    expect(c).toContain("IF md5(v_atual::text) <> c_md5 THEN");
    expect(c.match(/\bUPDATE\s+public\.notificacoes_fila\b/g)).toHaveLength(1);
  });

  it("guarda o original inteiro ANTES de trocar, e a troca só vale se a linha ainda é a lida", () => {
    const guarda = c.indexOf("INSERT INTO public.custo_em_texto_guardado");
    const troca = c.indexOf("UPDATE public.notificacoes_fila SET variaveis = v_novo");
    expect(guarda).toBeGreaterThan(0);
    expect(troca).toBeGreaterThan(guarda);
    expect(c).toContain("WHERE id = c_id AND variaveis = v_atual;");
    expect(c).toContain("IF v_linhas <> 1 THEN");
  });

  it("troca só a coluna variaveis, nunca o status, o destinatário ou a chave de idempotência", () => {
    expect([...c.matchAll(/\bSET\s+(\w+)\s*=/gi)].map((m) => m[1])).toEqual(["variaveis"]);
  });

  it("o texto novo não tem valor em reais e a migração confere isso por dentro", () => {
    const novo = c.slice(
      c.indexOf("v_novo := jsonb_build_object('texto',"),
      c.indexOf("INSERT INTO public.custo_em_texto_guardado"),
    );
    expect(novo).not.toContain("R$");
    expect(c).toContain(
      "RAISE EXCEPTION 'ainda sobrou valor em reais no alerta; nada foi alterado'",
    );
  });

  it("é seguro rodar de novo", () => {
    expect(c).toContain("o alerta de 28/10 já está sem valores");
    expect(c).toContain("o alerta de 28/10 não existe neste banco; nada a fazer");
  });
});
