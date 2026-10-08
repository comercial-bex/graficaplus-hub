import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Duas funções da equipe que só LEEM ainda tinham EXECUTE para `anon` depois
 * da 20261008040000 (que fechou as doze que gravam): custo_hora_sugerido e
 * get_relatorios_prioritarios. Fechadas na 20261008043800.
 *
 * Este arquivo também segura o FUTURO das catorze: função apagada e recriada
 * volta com EXECUTE para PUBLIC e anon (privilégio padrão do schema no
 * Supabase), e um GRANT descuidado devolve a porta. O teste da 20261008040000
 * confere só o conteúdo dela.
 */

const PASTA_MIGRACOES = join(__dirname, "..", "supabase/migrations");
const ESTA = "20261008043800_funcoes_que_leem_fechadas_para_anon.sql";
const QUE_GRAVAM = "20261008040000_funcoes_que_gravam_fechadas_para_anon.sql";

const QUE_LEEM = ["custo_hora_sugerido(uuid)", "get_relatorios_prioritarios(date, date)"];

const DA_EQUIPE = [
  // fechadas na 20261008040000
  "aplicar_custo_hora_sugerido",
  "avisar_manualmente",
  "buscar_usuario_para_portal",
  "cancelar_aviso",
  "cancelar_avisos_orfaos",
  "concluir_tarefa_os",
  "criar_link_aprovacao",
  "marcar_lead_perdido",
  "recalcular_previsao_custos",
  "receber_item_compra",
  "registrar_inspecao",
  "vincular_usuario_ao_portal",
  // fechadas nesta
  "custo_hora_sugerido",
  "get_relatorios_prioritarios",
];

function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

const MIGRACAO = readFileSync(join(PASTA_MIGRACOES, ESTA), "utf8");
const codigo = semComentarios(MIGRACAO);

describe("migração 20261008043800: funções que leem, fechadas para anon", () => {
  it("as duas estão na lista e mais nenhuma", () => {
    const lista = codigo.slice(codigo.indexOf("FOREACH"), codigo.indexOf("]::regprocedure[]"));
    expect([...lista.matchAll(/'public\.([^']+)'/g)].map((m) => m[1])).toEqual(QUE_LEEM);
  });

  it("tira de PUBLIC e anon, devolve a authenticated e confere com has_function_privilege", () => {
    expect(codigo).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon");
    expect(codigo).toContain("GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role");
    expect(codigo).toMatch(/IF has_function_privilege\('anon', v_funcao, 'EXECUTE'\) THEN\s+RAISE EXCEPTION/);
    expect(codigo).toMatch(/IF NOT has_function_privilege\('authenticated', v_funcao, 'EXECUTE'\) THEN\s+RAISE EXCEPTION/);
  });

  it("vem depois da 20261008040000, que fechou as que gravam", () => {
    expect(readdirSync(PASTA_MIGRACOES)).toContain(QUE_GRAVAM);
    expect(ESTA > QUE_GRAVAM).toBe(true);
  });
});

describe("migrações depois da 20261008040000 não devolvem função da equipe ao anônimo", () => {
  const depois = readdirSync(PASTA_MIGRACOES)
    .filter((f) => f.endsWith(".sql") && f > QUE_GRAVAM)
    .sort()
    .map((f) => ({ arquivo: f, sql: semComentarios(readFileSync(join(PASTA_MIGRACOES, f), "utf8")) }));

  it("nenhum GRANT delas para anon ou PUBLIC", () => {
    const culpados = depois.flatMap(({ arquivo, sql }) =>
      [...sql.matchAll(/GRANT\s+(?:EXECUTE|ALL)[^;]*?FUNCTION\s+(?:public\.)?(\w+)[^;]*\bTO\s+([^;]+);/gi)]
        .filter((m) => DA_EQUIPE.includes(m[1]) && /\b(anon|public)\b/i.test(m[2]))
        .map((m) => `${arquivo}: ${m[1]} → ${m[2].trim()}`),
    );
    expect(culpados).toEqual([]);
  });

  it("quem apaga e recria uma delas revoga o anon no mesmo arquivo", () => {
    const culpados = depois.flatMap(({ arquivo, sql }) =>
      DA_EQUIPE.filter((nome) =>
        new RegExp(`DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?${nome}\\b`, "i").test(sql),
      )
        .filter((nome) => !new RegExp(`'public\\.${nome}\\(|FUNCTION\\s+(?:public\\.)?${nome}\\b[^;]*FROM[^;]*\\banon\\b`, "i").test(sql))
        .map((nome) => `${arquivo}: ${nome}`),
    );
    expect(
      culpados,
      `Função recriada volta com EXECUTE para PUBLIC e anon. Revogue no mesmo arquivo (REVOKE ALL ON FUNCTION public.<nome>(...) FROM PUBLIC, anon):\n  ${culpados.join("\n  ")}`,
    ).toEqual([]);
  });
});
