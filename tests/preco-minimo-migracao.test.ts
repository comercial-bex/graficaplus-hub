import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Preço mínimo recomendado (16/11/2026): o contrato da migração e do roteiro de ensaio, lidos como TEXTO (nada aqui
 * fala com banco). O que o SQL faz de verdade foi provado no banco vivo, numa transação desfeita, e está em
 * docs/ensaio-preco-minimo.md.
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const NOME = "20261116130000_preco_minimo_recomendado.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const sql100 = readFileSync(join(PASTA, "20261116100000_custo_real_do_produto.sql"), "utf8");
const sql120 = readFileSync(join(PASTA, "20261116120000_custos_fixos_do_financeiro.sql"), "utf8");
const doc = readFileSync(join(RAIZ, "docs", "ensaio-preco-minimo.md"), "utf8");

const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigo = semComentarios(sql);

/** O que o Postgres guarda em prosrc: o texto entre os delimitadores `$function$`. */
function corpoDa(texto: string, nome: string): string {
  const i = texto.indexOf(`FUNCTION public.${nome}(`);
  if (i < 0) throw new Error(`sem ${nome}`);
  const ini = texto.indexOf("$function$", i) + "$function$".length;
  return texto.slice(ini, texto.indexOf("$function$", ini));
}
const md5 = (t: string) => createHash("md5").update(t).digest("hex");
/** O banco guarda o corpo sem as linhas só de comentário (foi assim que as migrações 100000 e 120000 ficaram vivas). */
const semLinhasDeComentario = (t: string) =>
  t
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

const guardas = (() => {
  const g = sql.slice(sql.indexOf("DO $guarda$"), sql.indexOf("END $guarda$"));
  const pega = (proc: string) => new RegExp(`proname = '${proc}';\\s*IF v_h IS DISTINCT FROM '([0-9a-f]{32})'`).exec(g)?.[1];
  return {
    cheio: pega("custo_cheio_do_produto"),
    confirmar: pega("confirmar_custo_fixo"),
    sincronizar: pega("sincronizar_precificacao_do_produto"),
    texto: g,
  };
})();

const VIEW_ANTIGA =
  "produto_id,nome,familia,preco_balcao,custo_producao,custo_real,margem_liquida_pct,vezes_o_custo,preco_regra_de_tres,sem_tinta,material_sem_custo,sem_mao_de_obra,custo_incompleto,velocidade_usada_m2_h,velocidade_nominal_m2_h,tempo_presumido,parceiro_abaixo_do_piso";
const COLUNAS_NOVAS = [
  "custo_ocupacao",
  "tres_x_material",
  "piso_custo_producao",
  "preco_minimo_recomendado",
  "trava_que_manda",
  "ocupacao_alvo_pct",
  "multiplicador_regra_de_tres",
];

const TRANSPARENTE = "504a9190-317b-4e44-8e7c-e9214ea0d1dd";
const RECORTADO = "622d3846-6b63-432f-8ee2-c073e7373c16";

describe("migração: arquivo, ordem e escopo", () => {
  it("vem depois de 120000 e o prefixo de data é único", () => {
    expect(NOME > "20261116120000_custos_fixos_do_financeiro.sql").toBe(true);
    expect(readdirSync(PASTA).filter((n) => n.startsWith("20261116130000_"))).toEqual([NOME]);
    const prefixos = readdirSync(PASTA).filter((n) => n.endsWith(".sql")).map((n) => n.slice(0, 14));
    expect(prefixos.filter((p) => p === "20261116130000")).toHaveLength(1);
  });

  it("é uma transação só, com lock_timeout curto, e termina em COMMIT", () => {
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(codigo).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("não escreve em preço, produto, orçamento, item, composição gravada, máquina nem material", () => {
    expect(codigo).not.toMatch(
      /(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\.(produtos|produto_precos|produto_precificacao|orcamentos|orcamento_itens|itens_os|materiais|maquinas|produto_materiais|custos_mao_de_obra)\b/i,
    );
    expect(codigo).not.toMatch(/\bpreco_base\s*=/i);
    expect(codigo).not.toMatch(/\bTRUNCATE\b|\bDROP\s+(TABLE|VIEW|COLUMN)\b/i);
    // g) a composição gravada não é recomposta: as quatro chaves que ela lê não mudam
    expect(codigo).not.toMatch(/PERFORM\s+public\.sincronizar_precificacao_do_produto/i);
    expect(codigo).not.toMatch(/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.(pendencias_de_custo|sincronizar_precificacao_do_produto|desconto_avaliar|meta_por_produto)\b/i);
  });

  it("só escreve em custos_tabela (INSERT) e em precos_propostas (UPDATE e INSERT)", () => {
    const alvos = [...codigo.matchAll(/(?:UPDATE|INSERT\s+INTO)\s+(public\.\w+)/g)].map((m) => m[1]);
    expect([...new Set(alvos)].sort()).toEqual(["public.custos_tabela", "public.precos_propostas"]);
    const foraDasFuncoes = codigo.replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(foraDasFuncoes).not.toMatch(/UPDATE\s+public\.custos_tabela/i);
    expect(codigo).not.toMatch(/DELETE\s+FROM/i);
  });
});

describe("guarda da troca na definição viva", () => {
  it("o md5 de custo_cheio_do_produto é o do corpo da 100000 sem as linhas de comentário", () => {
    expect(guardas.cheio).toBe(md5(semLinhasDeComentario(corpoDa(sql100, "custo_cheio_do_produto"))));
  });

  it("o md5 de confirmar_custo_fixo é o do corpo da 120000 sem as linhas de comentário", () => {
    expect(guardas.confirmar).toBe(md5(semLinhasDeComentario(corpoDa(sql120, "confirmar_custo_fixo"))));
  });

  it("os dois md5 vivos são os que o banco tinha em 16/11/2026", () => {
    expect(guardas.cheio).toBe("d6bf1523d90f88e619d4ff129f33d40e");
    expect(guardas.confirmar).toBe("2647b2cb62c7eb230e486175f6b85926");
    expect(guardas.sincronizar).toBe("c35b8affb3c51c2f40e3ce8a56c89d3a");
  });

  it("confere as colunas da view, os parâmetros novos ausentes e as propostas antes de mexer", () => {
    expect(guardas.texto).toContain(VIEW_ANTIGA);
    expect(guardas.texto).toContain("'ocupacao_alvo_pct', 'multiplicador_regra_de_tres'");
    expect(guardas.texto).toContain("origem = 'referencia_m2' AND preco_proposto = 69.9");
    expect(guardas.texto).toContain(RECORTADO);
  });

  it("os corpos novos não têm linha de comentário, para o md5 do arquivo ser o do banco depois", () => {
    for (const f of ["custo_cheio_do_produto", "confirmar_custo_fixo"]) {
      const c = corpoDa(sql, f);
      expect(c, f).not.toMatch(/^\s*--/m);
      expect(md5(c), f).toBe(md5(semLinhasDeComentario(c)));
    }
    // os dois números impressos pelo ensaio depois de rodar a migração
    expect(md5(corpoDa(sql, "custo_cheio_do_produto"))).toBe("a67875ec0aaaa9e94bc771b156175090");
    expect(md5(corpoDa(sql, "confirmar_custo_fixo"))).toBe("0f63f56aacd9d61e7aa79f2fb6f1431f");
  });
});

describe("parâmetros novos", () => {
  const ins = codigo.slice(codigo.indexOf("INSERT INTO public.custos_tabela"), codigo.indexOf("CREATE OR REPLACE FUNCTION public.custo_cheio_do_produto"));

  it("nascem numa instrução só, com 50 e 3, confirmados", () => {
    expect(codigo.match(/INSERT\s+INTO\s+public\.custos_tabela/g)).toHaveLength(1);
    expect(ins).toMatch(/\('geral', 'ocupacao_alvo_pct', 'Ocupação alvo das máquinas e da equipe', '%', 50,/);
    expect(ins).toMatch(/\('geral', 'multiplicador_regra_de_tres', 'Multiplicador da regra de três sobre o material', 'x', 3,/);
    expect(ins.match(/now\(\)/g)).toHaveLength(2);
  });

  it("descrição e observação sem parênteses, travessão nem seta", () => {
    const textos = [...ins.matchAll(/'([^']{12,})'/g)].map((m) => m[1]);
    expect(textos.length).toBeGreaterThanOrEqual(4);
    for (const t of textos) expect(t, t).not.toMatch(/[()—–→]/);
  });
});

describe("custo_cheio_do_produto: ocupação só em custo_producao", () => {
  const velho = semLinhasDeComentario(corpoDa(sql100, "custo_cheio_do_produto"));
  const f = corpoDa(sql, "custo_cheio_do_produto");

  it("custo_total, material, máquina, mão de obra, indireto, perdas e extra seguem com a mesma conta", () => {
    expect(f).toContain("'custo_total', round(v_material + v_maquina + v_mao + v_indireto, 4),");
    expect(f).toContain("'custo_perdas', round(v_perdas, 4),");
    expect(f).toContain("'custo_extra', round(v_extra, 4),");
    expect(f).toContain("'custo_maquina', round(v_maquina, 4),");
    expect(velho).toContain("'custo_total', round(v_material + v_maquina + v_mao + v_indireto, 4),");
  });

  it("custo_producao ganha a ocupação e custo_total não", () => {
    expect(f).toContain(
      "'custo_producao', round(v_material + v_maquina + v_mao + v_indireto + v_perdas + v_extra + v_custo_ocupacao, 4),",
    );
    expect(f).toContain("'custo_ocupacao', round(v_custo_ocupacao, 4),");
    expect(f).toContain("'ocupacao_alvo_pct', v_ocup_pct,");
    const total = /'custo_total', (round\([^\n]*\)),/.exec(f)![1];
    expect(total).not.toContain("v_custo_ocupacao");
  });

  it("a base da ocupação é máquina SEM energia mais mão de obra mais rateio; energia e perdas ficam de fora", () => {
    expect(f).toContain("v_custo_ocupacao := (v_maq_base + v_mao + v_indireto) * (100.0 / v_ocup_pct - 1);");
    expect(f).toContain("v_maquina := v_h_maq * v_maquina_custo;\n      v_maq_base := v_maquina;");
    // a energia soma em v_maquina DEPOIS de v_maq_base ter sido guardado
    expect(f.indexOf("v_maq_base := v_maquina;")).toBeLessThan(f.indexOf("v_maquina := v_maquina + v_h_maq * v_kw * v_tarifa;"));
    const base = /v_custo_ocupacao := \(([^)]*)\)/.exec(f)![1];
    expect(base).not.toMatch(/v_perdas|v_extra|v_tarifa|v_kw|v_maquina\b/);
  });

  it("ocupação limitada entre 5 e 100 e ausente vale 100 (sem ocupação)", () => {
    expect(f).toContain("v_ocup_pct := LEAST(GREATEST(COALESCE(v_ocup_pct, 100), 5), 100);");
    expect(f).toContain("max(valor) FILTER (WHERE codigo = 'ocupacao_alvo_pct') INTO v_ocup_pct");
  });

  it("serviço inteiro e produto sem máquina padrão não levam ocupação", () => {
    expect(f).toContain("IF NOT v_servico_inteiro AND p.maquina_padrao_id IS NOT NULL THEN");
    // o bloco da ocupação vem depois de zerar o serviço inteiro
    expect(f.indexOf("IF v_servico_inteiro THEN")).toBeLessThan(f.indexOf("IF NOT v_servico_inteiro AND p.maquina_padrao_id IS NOT NULL THEN"));
    expect(f).toContain("v_maquina := 0; v_mao := 0; v_indireto := 0; v_perdas := 0; v_extra := 0; v_maq_base := 0;");
  });

  it("tirando as partes novas, sobra o corpo antigo", () => {
    const volta = f
      .replace("\n  v_maq_base numeric := 0; v_ocup_pct numeric; v_custo_ocupacao numeric := 0;", "")
      .replace("      v_maquina := v_h_maq * v_maquina_custo;\n      v_maq_base := v_maquina;", "      v_maquina := v_h_maq * v_maquina_custo;")
      .replace(" v_extra := 0; v_maq_base := 0;", " v_extra := 0;")
      .replace(
        /  IF NOT v_servico_inteiro AND p\.maquina_padrao_id IS NOT NULL THEN[\s\S]*?\n  END IF;\n\n(?=  v_sem_mao)/,
        "",
      )
      .replace("    'custo_ocupacao', round(v_custo_ocupacao, 4),\n    'ocupacao_alvo_pct', v_ocup_pct,\n", "")
      .replace(" + v_extra + v_custo_ocupacao, 4),", " + v_extra, 4),");
    expect(volta).toBe(velho);
  });

  it("segue SECURITY DEFINER, STABLE, search_path fixo e EXECUTE só de service_role", () => {
    const cab = sql.slice(sql.indexOf("FUNCTION public.custo_cheio_do_produto("), sql.indexOf("$function$"));
    expect(cab).toContain("STABLE SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.custo_cheio_do_produto(uuid) FROM PUBLIC, anon, authenticated;");
    expect(codigo).toContain("GRANT EXECUTE ON FUNCTION public.custo_cheio_do_produto(uuid) TO service_role;");
  });
});

describe("view produto_custo_real", () => {
  const v = codigo.slice(codigo.indexOf("CREATE OR REPLACE VIEW public.produto_custo_real"), codigo.indexOf("COMMENT ON VIEW"));

  it("as colunas de hoje na mesma ordem e as sete novas no FIM", () => {
    const todas = [
      ...v.slice(v.indexOf("SELECT c.produto_id,") + 6, v.indexOf("FROM preco c;")).matchAll(/(?:^\s+c\.(\w+),$|AS (\w+)(?:,\s*$|\s*$))/gm),
    ].map((m) => m[1] ?? m[2]);
    expect(todas.join(",")).toBe(`${VIEW_ANTIGA},${COLUNAS_NOVAS.join(",")}`);
    expect(codigo).toContain(`${VIEW_ANTIGA},custo_ocupacao,tres_x_material,piso_custo_producao,preco_minimo_recomendado,trava_que_manda,ocupacao_alvo_pct,multiplicador_regra_de_tres`);
  });

  it("reaplica security_invoker e o GRANT só de service_role (CREATE OR REPLACE VIEW descarta as opções)", () => {
    expect(v).toContain("WITH (security_invoker = true)");
    expect(codigo).toContain("REVOKE ALL ON public.produto_custo_real FROM PUBLIC, anon, authenticated;");
    expect(codigo).toContain("GRANT SELECT ON public.produto_custo_real TO service_role;");
    expect(codigo).not.toMatch(/GRANT[^;]*produto_custo_real[^;]*\b(anon|authenticated|PUBLIC)\b/);
    const c = codigo.slice(codigo.indexOf("DO $confere$"));
    expect(c).toContain("security_invoker=true");
    expect(c).toContain("has_table_privilege('authenticated', 'public.produto_custo_real', 'SELECT')");
  });

  it("a fórmula: maior entre multiplicador vezes material com perda e o piso do custo de produção", () => {
    expect(v).toContain("b.mult * ((b.c ->> 'custo_material')::numeric + (b.c ->> 'custo_perdas')::numeric) AS tres_x_cru");
    expect(v).toContain("(b.c ->> 'custo_producao')::numeric / (1 - b.margem_minima / 100.0 - b.t)");
    expect(v).toContain("COALESCE(NULLIF(p.margem_minima, 0), 30) AS margem_minima");
    expect(v).toContain("GREATEST(c.tres_x_material, COALESCE(c.piso_custo_producao, 0))");
    expect(v).toContain("THEN 'regra_de_3' ELSE 'piso_custo'");
  });

  it("imposto e metade do cartão lidos de custos_tabela e multiplicador de 1 a 10", () => {
    expect(v).toContain("ct.codigo = 'impostos_venda'");
    expect(v).toContain("ct.codigo = 'taxa_cartao'");
    expect(v).toContain("/ 2) / 100, 0), 0.99) AS t,");
    expect(v).toContain("LEAST(GREATEST(COALESCE(max(ct.valor) FILTER (WHERE ct.codigo = 'multiplicador_regra_de_tres'), 3), 1), 10) AS mult");
  });

  it("arredonda os preços para CIMA no centavo", () => {
    expect(v).toContain("ceil(c.tres_x_cru * 100) / 100 AS tres_x_material");
    expect(v).toContain("ceil(c.piso_cru * 100) / 100 AS piso_custo_producao");
  });

  it("custo_real e margem_liquida_pct continuam saindo da mesma chave, agora com a ocupação", () => {
    expect(v).toContain("round((b.c ->> 'custo_producao')::numeric / (1 - b.t), 2) AS custo_real");
    expect(v).toContain("round((1 - c.custo_real / c.preco_balcao) * 100, 2) END AS margem_liquida_pct");
  });
});

describe("confirmar_custo_fixo", () => {
  const f = corpoDa(sql, "confirmar_custo_fixo");
  const antigo = corpoDa(sql120, "confirmar_custo_fixo");
  const cab = sql.slice(sql.indexOf("FUNCTION public.confirmar_custo_fixo("), sql.indexOf("$function$", sql.indexOf("FUNCTION public.confirmar_custo_fixo(")));

  it("mesma assinatura, SECURITY DEFINER e search_path fixo", () => {
    expect(cab).toContain("(p_codigo text, p_valor numeric, p_confirmar boolean DEFAULT true)");
    expect(cab).toContain("SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
  });

  it("a lista permitida são os dez de antes mais os dois novos, e nada de preço, margem ou markup", () => {
    const lista = (t: string) => {
      const i = t.indexOf("c_permitidos constant text[]");
      return [...t.slice(i, t.indexOf("];", i)).matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
    };
    expect(lista(f).sort()).toEqual([...lista(antigo), "ocupacao_alvo_pct", "multiplicador_regra_de_tres"].sort());
    expect(lista(f)).toHaveLength(12);
    for (const cod of lista(f)) expect(cod, cod).not.toMatch(/^(preco|margem|markup|impostos|taxa|pct_|mo_|custo_admin_hora|converter|prazo)/);
  });

  it("limites de 5 a 100 para a ocupação e de 1 a 10 para o multiplicador, antes de qualquer escrita", () => {
    expect(f).toContain("p_codigo = 'ocupacao_alvo_pct' AND (p_valor < 5 OR p_valor > 100)");
    expect(f).toContain("p_codigo = 'multiplicador_regra_de_tres' AND (p_valor < 1 OR p_valor > 10)");
    expect(f.indexOf("p_valor < 5 OR p_valor > 100")).toBeLessThan(f.indexOf("UPDATE public.custos_tabela"));
    expect(f.indexOf("p_valor < 1 OR p_valor > 10")).toBeLessThan(f.indexOf("UPDATE public.custos_tabela"));
  });

  it("custo zero segue recusado (só outros fixos aceita zero) e a permissão vem primeiro", () => {
    expect(f).toContain("p_valor = 0 AND p_codigo <> 'outros_fixos_admin_mes'");
    expect(f).toContain("v_uid := public.require_permission('custos.fixos.update');");
    expect(f.indexOf("require_permission")).toBeLessThan(f.indexOf("NOT (p_codigo = ANY (c_permitidos))"));
  });

  it("o resto do corpo é o de antes", () => {
    const volta = f
      .replace(", 'energia_tarifa_kwh', 'ocupacao_alvo_pct', 'multiplicador_regra_de_tres'];", ", 'energia_tarifa_kwh'];")
      .replace(/  IF p_codigo = 'ocupacao_alvo_pct'[\s\S]*?  IF p_codigo = 'multiplicador_regra_de_tres'[\s\S]*?\n  END IF;\n/, "");
    expect(volta).toBe(semLinhasDeComentario(antigo));
  });

  it("mensagens de tela sem parênteses, travessão nem seta", () => {
    const msgs = [...f.matchAll(/RAISE EXCEPTION '([^']*)'/g)].map((m) => m[1]);
    expect(msgs.length).toBeGreaterThan(8);
    for (const m of msgs) expect(m, m).not.toMatch(/[()—–→]/);
  });

  it("REVOKE de PUBLIC, anon, authenticated e service_role antes do GRANT só para authenticated", () => {
    const rev = "REVOKE ALL ON FUNCTION public.confirmar_custo_fixo(text, numeric, boolean) FROM PUBLIC, anon, authenticated, service_role;";
    const grant = "GRANT EXECUTE ON FUNCTION public.confirmar_custo_fixo(text, numeric, boolean) TO authenticated;";
    expect(codigo).toContain(rev);
    expect(codigo).toContain(grant);
    expect(codigo.indexOf(rev)).toBeLessThan(codigo.indexOf(grant));
    expect(codigo).not.toMatch(/GRANT[^;]*confirmar_custo_fixo[^;]*\b(anon|PUBLIC|service_role)\b/);
  });
});

describe("propostas de preço", () => {
  const ini = codigo.indexOf("CREATE TEMP TABLE _prop_novas");
  const bloco = codigo.slice(ini, codigo.indexOf("DO $confere$"));

  it("o transparente é UPDATE da pendente e o recortado é INSERT, ambos pendentes e de origem manual", () => {
    expect(bloco).toMatch(/UPDATE public\.precos_propostas pp[\s\S]*?pp\.status = 'pendente'[\s\S]*?n\.produto_id = '504a9190-317b-4e44-8e7c-e9214ea0d1dd'/);
    expect(bloco).toMatch(/INSERT INTO public\.precos_propostas[\s\S]*?'manual', 'pendente'[\s\S]*?n\.produto_id = '622d3846-6b63-432f-8ee2-c073e7373c16'/);
    expect(bloco.match(/origem = 'manual'/g)).toHaveLength(1);
    expect(bloco).not.toMatch(/status\s*=\s*'(aprovada|recusada)'/);
    expect(bloco).not.toMatch(/decidido_(por|em)\s*=/);
  });

  it("o preço proposto é o menor valor terminado em 0,90 ou 0,00 igual ou acima do mínimo", () => {
    expect(bloco).toContain("LEAST(ceil(r.preco_minimo_recomendado),");
    expect(bloco).toContain("CASE WHEN floor(r.preco_minimo_recomendado) + 0.90 >= r.preco_minimo_recomendado");
    expect(bloco).toContain("THEN floor(r.preco_minimo_recomendado) + 0.90 END) AS novo");
  });

  it("o motivo não leva custo em reais, parênteses, travessão nem seta, e cabe no limite de 500", () => {
    const textos = [...bloco.matchAll(/'([^'\n]{20,})'/g)].map((m) => m[1]).filter((t) => /preço|margem/i.test(t));
    expect(textos.length).toBeGreaterThanOrEqual(2);
    for (const t of textos) {
      expect(t, t).not.toMatch(/[()—–→]/);
      expect(t, t).not.toMatch(/R\$/);
    }
    // não usa custo_producao nem custo_real dentro do texto do motivo
    const motivos = bloco.slice(bloco.indexOf("motivo = "), bloco.indexOf("FROM _prop_novas n"));
    expect(motivos).not.toMatch(/n\.custo_producao|n\.custo_real\s*\)\s*\|\|/);
  });

  it("confere a pendente antes e a conferência final recusa motivo com sinal proibido", () => {
    expect(guardas.texto).toContain("preco_proposto = 69.9");
    const c = codigo.slice(codigo.indexOf("DO $confere$"));
    expect(c).toContain("motivo ~ '[()]|—|–|→'");
    expect(c).toContain("<> 2 THEN");
  });
});

describe("a conferência final", () => {
  const c = codigo.slice(codigo.indexOf("DO $confere$"));
  it("trava ordem das colunas, acesso, parâmetros e as duas travas do mínimo", () => {
    expect(c).toContain("colunas da view fora de ordem");
    expect(c).toContain("SELECT de produto_custo_real deveria ser só de service_role");
    expect(c).toContain("EXECUTE de custo_cheio_do_produto deveria ser só de service_role");
    expect(c).toContain("EXECUTE de confirmar_custo_fixo deveria ser só de authenticated");
    expect(c).toContain("valor IN (50, 3)");
    expect(c).toContain("preço mínimo abaixo de uma das duas travas");
  });
});

/**
 * A conta, em TypeScript, com as entradas vivas de 16/11/2026: prova que o mínimo do ensaio sai da decisão do dono
 * (energia fora da ocupação) e não do exemplo (que dividiu a energia também).
 */
describe("a conta das decisões, com as entradas vivas", () => {
  const taxa = 0.06 + 0.035 / 2;
  const arred = (x: number) => Math.round(x * 100) / 100;
  const cima = (x: number) => Math.ceil(Math.round(x * 100 * 1e6) / 1e6) / 100;

  function minimo(o: { material: number; maqSemEnergia: number; energia: number; mao: number; rateio: number; mm: number; ocup?: number; mult?: number }) {
    const ocup = Math.min(Math.max(o.ocup ?? 50, 5), 100) / 100;
    const mat = o.material * 1; // já é material com perda e falha
    const conversao = (o.maqSemEnergia + o.mao + o.rateio) / ocup + o.energia;
    const producao = mat + conversao;
    const tres = cima((o.mult ?? 3) * mat);
    const piso = cima(producao / (1 - o.mm / 100 - taxa));
    return { conversao, producao, tres, piso, minimo: Math.max(tres, piso), trava: tres >= piso ? "regra_de_3" : "piso_custo" };
  }
  // i1600: 0,1 h por m2 a 14 vs 10 m2 por hora de cálculo, R$ 14,4313 por hora, 1 kW, R$ 1,1339 por kWh
  const impressao = { maqSemEnergia: 1.44313, energia: 0.11339, mao: 1.8349, rateio: 1.875 };
  const recorte = { maqSemEnergia: 0.40798, energia: 0.06614, mao: 7.1359, rateio: 7.2917 };

  it("Adesivo transparente: regra de três manda, 71,73", () => {
    const r = minimo({ ...impressao, material: 20.801 / 0.87, mm: 30 });
    expect(arred(r.conversao)).toBe(10.42);
    expect(r.trava).toBe("regra_de_3");
    expect(r.minimo).toBeCloseTo(71.73, 2);
  });

  it("Lona 440g: regra de três manda, 69,87", () => {
    const r = minimo({ ...impressao, material: 20.2615 / 0.87, mm: 35 });
    expect(r.trava).toBe("regra_de_3");
    expect(r.minimo).toBeCloseTo(69.87, 2);
  });

  it("Adesivo vinil recortado: o piso do custo manda, 72,84, e a proposta é 72,90", () => {
    const r = minimo({ ...recorte, material: 7.238 / 0.87, mm: 40 });
    expect(arred(r.conversao)).toBe(29.74);
    expect(r.trava).toBe("piso_custo");
    expect(r.minimo).toBeCloseTo(72.84, 1);
    const novo = Math.min(Math.ceil(r.minimo), Math.floor(r.minimo) + 0.9 >= r.minimo ? Math.floor(r.minimo) + 0.9 : Infinity);
    expect(arred(novo)).toBe(72.9);
  });

  it("com a energia dividida também (o exemplo do dono) a conversão sai 10,53 e 29,80", () => {
    expect(arred(2 * (impressao.maqSemEnergia + impressao.energia + impressao.mao + impressao.rateio))).toBe(10.53);
    expect(arred(2 * (recorte.maqSemEnergia + recorte.energia + recorte.mao + recorte.rateio))).toBe(29.8);
  });

  it("a ocupação nunca sai de 5 a 100 por cento", () => {
    const a = minimo({ ...impressao, material: 10, mm: 30, ocup: 1 });
    const b = minimo({ ...impressao, material: 10, mm: 30, ocup: 5 });
    expect(a.conversao).toBe(b.conversao);
    const c = minimo({ ...impressao, material: 10, mm: 30, ocup: 500 });
    const d = minimo({ ...impressao, material: 10, mm: 30, ocup: 100 });
    expect(c.conversao).toBe(d.conversao);
  });
});

describe("roteiro e resultado do ensaio no documento", () => {
  const blocos = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
  const prefixo = blocos.find((b) => b.includes("CREATE TEMP TABLE _antes"))!;
  const sufixo = blocos.find((b) => b.includes("ENSAIO DESFEITO"))!;

  it("diz que foi ensaiada e desfeita, e que não foi aplicada", () => {
    expect(doc).toContain("desfeita por RAISE EXCEPTION");
    expect(doc).toContain("NÃO aplicada");
    expect(doc).toContain("20261116130000_preco_minimo_recomendado.sql");
  });

  it("o roteiro tira a foto antes e termina em RAISE EXCEPTION, nunca em COMMIT", () => {
    expect(prefixo).toBeDefined();
    expect(sufixo).toBeDefined();
    expect(prefixo).toContain("ON COMMIT DROP");
    expect(sufixo).toMatch(/RAISE EXCEPTION E'ENSAIO DESFEITO/);
    expect(prefixo + sufixo).not.toMatch(/\bCOMMIT;/);
    for (const papel of ["'gestor'", "'financeiro'", "'vendedor'"]) expect(sufixo).toContain(papel);
    expect(sufixo).toContain("SET LOCAL ROLE authenticated");
    expect(sufixo).toContain("request.jwt.claim.sub");
  });

  it("prova hash igual para preço, orçamento, item de OS, composição e piso de desconto", () => {
    for (const t of ["produtos (linha inteira)", "produto_precos (linha inteira)", "orcamento_itens (linha inteira)", "itens_os (linha inteira)", "produto_precificacao (sem updated_at)", "produto_custo_cheio", "desconto_avaliar"]) {
      expect(sufixo, t).toContain(t);
    }
    expect(doc).toMatch(/\| `produtos`, linha inteira[^\n]*\| IGUAL \|/);
    expect(doc).toMatch(/\| `orcamento_itens`, linha inteira \| IGUAL \|/);
    expect(doc).toMatch(/\| `itens_os`, linha inteira \| IGUAL \|/);
    expect(doc).toMatch(/\| `produto_precos`, linha inteira \| IGUAL \|/);
    expect(doc).not.toMatch(/\| DIFERENTE \|/);
  });

  it("traz os números das duas propostas e o efeito em parceiro e orçamentos abertos", () => {
    expect(doc).toContain("| Adesivo transparente | 59,90 | 71,73 | 71,90 |");
    expect(doc).toContain("| Adesivo vinil recortado | 68,00 | 72,84 | 72,90 |");
    expect(doc).toContain("| Pendências de parceiro | 6 | 7 |");
    expect(doc).toContain("São 60 orçamentos abertos");
    expect(doc).toContain("## Conferência com o exemplo do dono");
  });
});
