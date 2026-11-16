import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lembrete diário de pendências de custo: o contrato da migração e do roteiro de ensaio, lidos como TEXTO
 * (nada aqui fala com banco). O que o SQL faz de verdade foi provado no banco vivo, dentro de uma transação
 * desfeita, e está em docs/ensaio-lembrete-de-custos.md.
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const NOME = "20261116110000_lembrete_diario_de_custos.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const doc = readFileSync(join(RAIZ, "docs", "ensaio-lembrete-de-custos.md"), "utf8");

const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigo = semComentarios(sql);

function comandosSemWhere(s: string): string[] {
  const achados: string[] = [];
  const re = /\b(UPDATE\s+(?:ONLY\s+)?[\w.]+\s+(?:\w+\s+)?SET\b|DELETE\s+FROM\s+(?:ONLY\s+)?[\w.]+)([\s\S]*?)(?:;|$)/gi;
  for (const m of s.matchAll(re)) {
    if (!/\bWHERE\b/i.test(m[0])) achados.push(m[0].replace(/\s+/g, " ").slice(0, 120));
  }
  return achados;
}

/** O corpo de uma função: entre `AS $f$` e o `$f$` que fecha, a partir do nome. */
function corpoDe(nome: string): string {
  const i = codigo.indexOf(`FUNCTION public.${nome}(`);
  if (i < 0) throw new Error(`sem ${nome}`);
  const ini = codigo.indexOf("$f$", i) + 3;
  return codigo.slice(ini, codigo.indexOf("$f$", ini));
}

const FUNCOES = [
  "_custo_texto_limpo(text)",
  "pendencias_de_custo()",
  "_lembrete_custos_enfileirar(text, text, text, text, jsonb, uuid)",
  "lembrete_diario_de_custos(boolean, date)",
];

/** O texto que sai nas mensagens: as constantes entre os marcadores TEXTO:INICIO e TEXTO:FIM. */
const textoDoAviso = sql.slice(sql.indexOf("-- TEXTO:INICIO"), sql.indexOf("-- TEXTO:FIM"));

const blocosSql = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
const ensaio = blocosSql.find((b) => b.includes("ENSAIO OK"))!;
const volta = blocosSql.find((b) => b.includes("DO $volta$"))!;

describe("migração: arquivo e escopo", () => {
  it("vem depois da migração do banco de custo real e o prefixo de data é único", () => {
    expect(NOME > "20261116100000").toBe(true);
    expect(NOME > "20261115200000_aviso_privado_do_gerente.sql").toBe(true);
    expect(readdirSync(PASTA).filter((n) => n.startsWith(NOME.slice(0, 14)))).toEqual([NOME]);
  });

  it("abre com BEGIN e lock_timeout curto, fecha com COMMIT depois da conferência", () => {
    const i = sql.indexOf("BEGIN;");
    expect(i).toBeGreaterThan(-1);
    expect(sql.indexOf("SET LOCAL lock_timeout = '5s';")).toBeGreaterThan(i);
    expect(sql.lastIndexOf("COMMIT;")).toBeGreaterThan(sql.indexOf("DO $confere$"));
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("nenhum UPDATE nem DELETE, nenhum DROP, e nenhuma escrita em produto, preço, orçamento ou custo", () => {
    expect(comandosSemWhere(codigo)).toEqual([]);
    expect(codigo).not.toMatch(/\b(UPDATE|DELETE\s+FROM)\b/i);
    expect(codigo).not.toMatch(/\bTRUNCATE\b|\bDROP\s+(TABLE|FUNCTION|VIEW)\b/i);
    expect(codigo).not.toMatch(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(produtos|produto_|orcamento|custos_|materiais|maquinas)/i);
    expect(codigo).not.toMatch(/preco_base\s*=/i);
  });

  it("só escreve onde deve: log, fila (pela função da fila) e o agendamento. Nada em whatsapp_feriados", () => {
    const inserts = [...codigo.matchAll(/INSERT\s+INTO\s+(public\.\w+)/gi)].map((m) => m[1]);
    expect([...new Set(inserts)].sort()).toEqual(["public.logs_auditoria"]);
    expect(codigo).not.toContain("whatsapp_feriados");
    expect(codigo).not.toMatch(/INSERT\s+INTO\s+public\.notificacoes_fila/i);
    expect(corpoDe("_lembrete_custos_enfileirar")).toContain("public.enfileirar_notificacao('whatsapp'");
  });

  it("não cria tabela, coluna nem policy: só função e job", () => {
    expect(codigo).not.toMatch(/\bCREATE\s+(TABLE|VIEW|POLICY|INDEX|TRIGGER)\b/i);
    expect(codigo).not.toMatch(/\bALTER\s+TABLE\b/i);
  });
});

describe("migração: acesso", () => {
  it("toda função nova tem REVOKE de PUBLIC, anon, authenticated e service_role antes de qualquer GRANT", () => {
    for (const f of FUNCOES) {
      const rev = `REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated, service_role;`;
      expect(codigo, f).toContain(rev);
      const g = codigo.indexOf(`GRANT EXECUTE ON FUNCTION public.${f}`);
      if (g >= 0) expect(g).toBeGreaterThan(codigo.indexOf(rev));
    }
    expect([...codigo.matchAll(/CREATE OR REPLACE FUNCTION/g)]).toHaveLength(FUNCOES.length);
  });

  it("só service_role executa as duas funções públicas; nada para anon, authenticated ou PUBLIC", () => {
    const grants = [...codigo.matchAll(/GRANT EXECUTE ON FUNCTION public\.([^ ]+(?: [^ ]+)?) TO (\w+);/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(grants.sort()).toEqual(["lembrete_diario_de_custos(boolean, date) service_role", "pendencias_de_custo() service_role"]);
    expect(codigo).not.toMatch(/GRANT[^;]*\b(anon|authenticated|PUBLIC)\b/);
  });

  it("as funções são SECURITY DEFINER com search_path fixo e o lembrete recusa pessoa logada", () => {
    for (const f of ["pendencias_de_custo", "_lembrete_custos_enfileirar", "lembrete_diario_de_custos"]) {
      const i = codigo.indexOf(`FUNCTION public.${f}(`);
      const cab = codigo.slice(i, codigo.indexOf("$f$", i));
      expect(cab, f).toContain("SECURITY DEFINER");
      expect(cab, f).toContain("SET search_path = public");
    }
    const c = corpoDe("lembrete_diario_de_custos");
    expect(c).toContain("auth.uid() IS NOT NULL");
    expect(c).toContain("ERRCODE = '42501'");
  });

  it("a conferência final trava anon e authenticated, confere service_role e os dois jobs", () => {
    const c = codigo.slice(codigo.indexOf("DO $confere$"));
    expect(c).toContain("has_function_privilege('anon', 'public.pendencias_de_custo()', 'EXECUTE')");
    expect(c).toContain("has_function_privilege('authenticated', 'public.lembrete_diario_de_custos(boolean, date)', 'EXECUTE')");
    expect(c).toContain("jobname = 'pendencias-de-custo' AND active AND schedule = '0 11,13 * * 1-6'");
    expect(c).toContain("jobname = 'integridade-orcamentos' AND active");
    expect(c).not.toContain("whatsapp_feriados");
  });
});

describe("pendencias_de_custo", () => {
  const c = corpoDe("pendencias_de_custo");

  it("devolve codigo, rotulo e tipo, e lê os 9 códigos do contrato", () => {
    expect(codigo).toContain("RETURNS TABLE (codigo text, rotulo text, tipo text)");
    for (const cod of [
      "aluguel_espaco_mensal",
      "outros_fixos_admin_mes",
      "plotter_horas_mes_reais",
      "energia_comercial_tarifa_kwh",
      "tinta_consumo_ml_m2",
      "plotter_manutencao_mensal",
      "plotter_cabecote_custo",
      "plotter_cabecote_vida_m2",
      "plotter_limpeza_mensal",
    ]) {
      expect(c, cod).toContain(`'${cod}'`);
    }
  });

  it("pendente é valor nulo ou confirmado_em nulo, e tolera a coluna e a view ainda não existirem", () => {
    expect(c).toContain("c.valor IS NULL OR {PENDENTE}");
    expect(c).toContain("c.confirmado_em IS NULL");
    expect(c).toContain("a.attname = 'confirmado_em'");
    expect(c).toContain("to_regclass('public.produto_custo_real')");
    expect(c).toContain("public.custo_cheio_do_produto(p.id)");
    expect(c).toContain("r.custo_producao FROM public.produto_custo_real r");
  });

  it("material: ativo, custo zerado pela conta do motor, em uso por produto ativo", () => {
    expect(c).toContain("m.status = 'ativo' AND COALESCE(m.custo_medio, m.custo_unitario, 0) <= 0");
    expect(c).toContain("p.ativo");
  });

  it("parceiro: piso líquido = custo de produção sobre um menos margem mínima menos taxas, com taxas lidas do banco", () => {
    expect(c).toContain("w.custo / (1 - w.mm / 100.0 - t.t)");
    expect(c).toContain("codigo = 'impostos_venda'");
    expect(c).toContain("codigo = 'taxa_cartao'");
    expect(c).toContain("/ 2.0");
    expect(c).toContain("round(k.preco, 2) < round(k.piso_liquido, 2)");
    expect(c).toContain("min(c.preco)");
    expect(c).toContain("p.preco_parceiro_acima");
    expect(c).toContain("produto_faixas_preco");
  });

  it("margem mínima vazia ou zero vale 30, como desconto_avaliar e a visão do custo real", () => {
    expect(c).toContain("COALESCE(NULLIF(p.margem_minima, 0), 30) AS mm");
  });

  it("o rótulo não leva valor em reais: só percentual e nomes", () => {
    expect(c).not.toMatch(/R\$/);
    expect(c).not.toMatch(/to_char\(|_integridade_brl|\bvalor::text|'\s*\|\|\s*c\.valor/);
    const rotulos = c.slice(c.indexOf("par AS ("), c.indexOf("base AS ("));
    expect(rotulos).not.toMatch(/\|\|\s*c\.valor/);
  });
});

describe("lembrete_diario_de_custos: texto e envio", () => {
  const c = corpoDe("lembrete_diario_de_custos");
  const e = corpoDe("_lembrete_custos_enfileirar");

  it("o texto das mensagens não tem parênteses, travessão, seta nem valor em reais", () => {
    expect(textoDoAviso.length).toBeGreaterThan(200);
    const literais = textoDoAviso
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(literais).not.toMatch(/[()]/);
    expect(literais).not.toMatch(/[—–→←]/);
    expect(literais).not.toMatch(/->|=>/);
    expect(literais).not.toMatch(/R\$/);
    expect(literais).not.toMatch(/[0-9],[0-9]/);
  });

  it("o texto tem os pedaços que o dono pediu: gerente e financeiro, link, volta todo dia útil e aos sábados", () => {
    expect(textoDoAviso).toContain("Bom dia, gerente e financeiro");
    expect(textoDoAviso).toContain("Pendências de custo da Bex Print, {itens}");
    expect(textoDoAviso).toContain("{lista}");
    expect(textoDoAviso).toContain("https://bexprint.com.br/custos-producao");
    expect(textoDoAviso).toContain("volta todo dia útil e aos sábados, no início do dia, até a lista zerar");
    expect(textoDoAviso).not.toMatch(/\d\s?h\b/);
    expect(textoDoAviso).toContain("Gestor e financeiro, preencham e confirmem os números na tela.");
    expect(textoDoAviso).toContain("foram todas atualizadas");
  });

  it("a mensagem do código nunca é formatada com valor em reais", () => {
    expect(c).not.toMatch(/R\$|to_char\(|_integridade_brl/);
  });

  it("limite de 12 linhas e o resto vira contagem", () => {
    expect(c).toContain("c_limite constant integer := 12");
    expect(c).toContain("generate_series(1, LEAST(v_n, c_limite))");
    expect(c).toContain("E mais");
  });

  it("grupo da equipe com menção de verdade; privado só para gestor ou admin e sem menção", () => {
    expect(c).toContain("public.grupo_equipe_destino()");
    expect(c).toContain("'aviso_grupo_equipe'");
    expect(c).toContain("to_jsonb(v_tel)");
    expect(c).toContain("ur.role IN ('gestor'::public.app_role, 'financeiro'::public.app_role)");
    expect(c).toContain("'aviso_gerente_privado'");
    expect(c).toContain("ur.role IN ('gestor'::public.app_role, 'admin'::public.app_role)");
    expect(c).toContain("public.normalize_whatsapp_phone(u.telefone)");
    // nenhum número de telefone escrito no código
    expect(codigo).not.toMatch(/\b55[0-9]{10,11}\b/);
    expect(codigo).not.toMatch(/'[0-9]{10,13}'/);
    expect(c).toContain("v_texto, NULL, r.id");
  });

  it("chave diária, e a próxima só nasce depois de falhou ou cancelado, no máximo 3 por dia", () => {
    expect(c).toContain("'pendencias_custo:grupo:'");
    expect(c).toContain("'pendencias_custo:privado:'");
    expect(c).toContain("'pendencias_custo:fim:grupo:'");
    expect(c).toContain("'pendencias_custo:fim:privado:'");
    expect(e).toContain("FOR v_k IN 0..2 LOOP");
    expect(e).toContain("':r' || v_k");
    expect(e).toContain("v_status IN ('falhou', 'cancelado')");
    expect(e).toContain("RETURN 'esgotado'");
    expect(e).toContain("'usuario'");
  });

  it("domingo e feriado da lista própria não enviam, sábado envia, e o modo seco não grava nada", () => {
    expect(c).toContain("extract(isodow FROM v_hoje) = 7");
    // sábado (isodow 6) não é barrado
    expect(c).not.toMatch(/isodow FROM v_hoje\) (>=|IN|=) \(?6/);
    expect(c).not.toContain("whatsapp_feriados");
    for (const d of ["2026-11-20", "2026-12-25", "2027-01-01"]) expect(c).toContain(`DATE '${d}'`);
    expect(c).toContain("WHERE f.data = v_hoje");
    const seco = c.slice(c.indexOf("IF NOT p_enfileirar THEN"), c.indexOf("IF NOT v_util THEN"));
    expect(seco).toContain("RETURN jsonb_build_object(");
    expect(seco).not.toMatch(/INSERT|_lembrete_custos_enfileirar|enfileirar_notificacao/);
  });

  it("para sozinho: lista vazia não envia, e o aviso de fim sai uma vez só por ciclo", () => {
    expect(c).toContain("IF v_n = 0 AND NOT v_manda_fim THEN");
    expect(c).toContain("v_manda_fim := v_ult_lembrete IS NOT NULL AND (v_ult_fim IS NULL OR v_ult_lembrete > v_ult_fim)");
  });

  it("falha nunca fica em silêncio: WARNING e linha em logs_auditoria", () => {
    expect(c).toContain("'lembrete_diario_falha'");
    expect(c).toContain("RAISE WARNING 'lembrete de custos: %'");
    expect(c).toContain("v_res IN ('sem_destino', 'recusado', 'esgotado')");
    // O único tratador de erro da função não é mudo: avisa, grava a falha e devolve o erro.
    expect((c.match(/EXCEPTION\s+WHEN\s+OTHERS/gi) ?? []).length).toBe(1);
    const tratador = c.slice(c.search(/EXCEPTION\s+WHEN\s+OTHERS/i));
    expect(tratador).toContain("RAISE WARNING 'lembrete de custos: não foi possível listar as pendências: %'");
    expect(tratador).toContain("'lembrete_diario_falha'");
    expect(tratador).toContain("'erro', v_erro");
  });

  it("lista que não monta (coluna ou visão com outro nome) vira falha registrada, e o modo seco não grava", () => {
    expect(c).toMatch(/IF p_enfileirar THEN\s+INSERT INTO public\.logs_auditoria[\s\S]*?'lembrete_diario_falha'/);
    expect(c).toContain("'motivo', 'erro ao listar pendências'");
  });
});

describe("agendamento e feriado", () => {
  it("cron 11:00 e 13:00 UTC de segunda a sábado, função SQL pura, sem URL nem segredo", () => {
    expect(codigo).toContain("cron.schedule('pendencias-de-custo', '0 11,13 * * 1-6', 'SELECT public.lembrete_diario_de_custos()')");
    expect(codigo).not.toMatch(/net\.http_post|vault\.|x-despachante/i);
  });

  it("o alerta de integridade sai do minuto 0 para o 20, só se ainda estiver no horário original", () => {
    expect(codigo).toContain("j.jobname = 'integridade-orcamentos' AND j.schedule = '0 11-21 * * 1-6'");
    expect(codigo).toContain("cron.alter_job(v_id, schedule => '20 11-21 * * 1-6')");
  });

  it("o feriado fica numa lista própria e o cabeçalho explica por que a triagem não é tocada", () => {
    expect(codigo).not.toContain("whatsapp_feriados");
    expect(sql).toContain("NAO toca em whatsapp_feriados");
    expect(sql).toContain("SEM tocar em whatsapp_feriados");
  });
});

describe("roteiro de ensaio no docs", () => {
  it("termina com RAISE EXCEPTION e roda no banco vivo sem gravar", () => {
    expect(ensaio).toContain("RAISE EXCEPTION 'ENSAIO OK%'");
    expect(ensaio).not.toMatch(/\bCOMMIT\b/);
    expect(doc).toContain("NÃO aplicada");
    expect(doc).toContain("20261116100000");
  });

  it("cobre o que a entrega pediu", () => {
    for (const trecho of [
      "lembrete_diario_de_custos(false",
      "'2026-11-22'",
      "'2026-11-20'",
      "pendencias_custo:grupo:2026-11-16:r1",
      "grupo_equipe_ativo = false",
      "has_function_privilege('anon'",
      "request.jwt.claim.sub",
      "precos de produto iguais antes e depois",
      "cron.job",
    ]) {
      expect(ensaio, trecho).toContain(trecho);
    }
  });

  it("o texto do aviso do doc não leva valor em reais, parênteses, travessão nem seta", () => {
    const bloco = doc.slice(doc.indexOf("Grupo da equipe, com os celulares"), doc.indexOf("Privado do gerente:"));
    const texto = bloco.slice(bloco.indexOf("```\n") + 4, bloco.lastIndexOf("```"));
    expect(texto).toContain("Bom dia, gerente e financeiro");
    expect(texto).not.toMatch(/R\$|[()—–→]|->/);
  });

  it("a volta desfaz job, minuto da integridade e funções, sem mexer em feriado", () => {
    expect(volta).toContain("cron.unschedule('pendencias-de-custo')");
    expect(volta).toContain("cron.alter_job(v_id, schedule => '0 11-21 * * 1-6')");
    for (const f of ["lembrete_diario_de_custos(boolean, date)", "pendencias_de_custo()", "_custo_texto_limpo(text)"]) {
      expect(volta).toContain(`DROP FUNCTION IF EXISTS public.${f};`);
    }
    expect(volta).not.toContain("whatsapp_feriados");
  });
});
