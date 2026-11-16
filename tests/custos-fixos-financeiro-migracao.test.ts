import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Custos fixos pelo financeiro (16/11/2026): o contrato da migração, do roteiro de ensaio e da tela, lidos como TEXTO
 * (nada aqui fala com banco). O que o SQL faz de verdade foi provado no banco vivo, numa transação desfeita, com
 * admin, gestor, financeiro e vendedor, e está em docs/ensaio-custos-fixos-financeiro.md.
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const NOME = "20261116120000_custos_fixos_do_financeiro.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const sql100 = readFileSync(join(PASTA, "20261116100000_custo_real_do_produto.sql"), "utf8");
const doc = readFileSync(join(RAIZ, "docs", "ensaio-custos-fixos-financeiro.md"), "utf8");
const tela = readFileSync(join(RAIZ, "src/components/custos/custos-fixos-da-grafica.tsx"), "utf8");

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

const NOVE = [
  "aluguel_espaco_mensal",
  "outros_fixos_admin_mes",
  "plotter_horas_mes_reais",
  "energia_comercial_tarifa_kwh",
  "tinta_consumo_ml_m2",
  "plotter_manutencao_mensal",
  "plotter_cabecote_custo",
  "plotter_cabecote_vida_m2",
  "plotter_limpeza_mensal",
];

describe("migração: arquivo, ordem e escopo", () => {
  it("vem depois de 100000 e 110000 e o prefixo de data é único", () => {
    expect(NOME > "20261116110000_lembrete_diario_de_custos.sql").toBe(true);
    expect(readdirSync(PASTA).filter((n) => n.startsWith("20261116120000_"))).toEqual([NOME]);
  });

  it("é uma transação só, com lock_timeout curto", () => {
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(codigo).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("não escreve em preço, produto, orçamento, item nem em outro código de custo", () => {
    expect(codigo).not.toMatch(/(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\.(produtos|produto_precos|produto_precificacao|orcamento|itens_os|materiais|maquinas)/i);
    expect(codigo).not.toMatch(/\bpreco_base\s*=/i);
    expect(codigo).not.toMatch(/whatsapp_feriados/);
    expect(codigo).not.toMatch(/\bTRUNCATE\b|\bDROP\s+(TABLE|VIEW|COLUMN)\b/i);
  });
});

describe("permissão custos.fixos.update", () => {
  it("entra em permissoes antes de perfil_permissoes (chave estrangeira) e só para admin, gestor e financeiro", () => {
    const iPerm = codigo.indexOf("INSERT INTO public.permissoes");
    const iPerfil = codigo.indexOf("INSERT INTO public.perfil_permissoes");
    expect(iPerm).toBeGreaterThan(-1);
    expect(iPerfil).toBeGreaterThan(iPerm);
    expect(codigo).toMatch(/VALUES \('custos\.fixos\.update', 'resultado'/);
    expect(codigo).toMatch(/VALUES \('admin'\), \('gestor'\), \('financeiro'\)/);
    expect(codigo).toContain("ON CONFLICT (perfil, permissao) DO NOTHING");
    expect(codigo).not.toMatch(/'custos\.update'/);
  });

  it("a conferência final trava os três perfis e recusa qualquer outro", () => {
    const c = codigo.slice(codigo.indexOf("DO $confere$"));
    expect(c).toContain("perfil IN ('admin', 'gestor', 'financeiro')) <> 3");
    expect(c).toContain("perfil NOT IN ('admin', 'gestor', 'financeiro')");
  });
});

describe("confirmar_custo_fixo", () => {
  const f = corpoDa(sql, "confirmar_custo_fixo");
  const cab = sql.slice(sql.indexOf("FUNCTION public.confirmar_custo_fixo("), sql.indexOf("$function$", sql.indexOf("FUNCTION public.confirmar_custo_fixo(")));

  it("assinatura, SECURITY DEFINER e search_path fixo", () => {
    expect(cab).toContain("(p_codigo text, p_valor numeric, p_confirmar boolean DEFAULT true)");
    expect(cab).toContain("SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
  });

  it("exige a permissão pela função do repo, antes de qualquer outra coisa", () => {
    expect(f).toContain("v_uid := public.require_permission('custos.fixos.update');");
    expect(f.indexOf("require_permission")).toBeLessThan(f.indexOf("NOT (p_codigo = ANY (c_permitidos))"));
    expect(f.indexOf("require_permission")).toBeLessThan(f.indexOf("UPDATE public.custos_tabela"));
  });

  it("só aceita os nove códigos do contrato e energia_tarifa_kwh, e nada de preço, margem ou markup", () => {
    const lista = f.slice(f.indexOf("c_permitidos constant text[]"), f.indexOf("];", f.indexOf("c_permitidos constant text[]")));
    const achados = [...lista.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
    expect(achados.sort()).toEqual([...NOVE, "energia_tarifa_kwh"].sort());
    for (const cod of achados) expect(cod, cod).not.toMatch(/^(preco|margem|markup|impostos|taxa|pct_|mo_|custo_admin_hora|converter|prazo)/);
    expect(f).toContain("NOT (p_codigo = ANY (c_permitidos))");
  });

  it("valida valor e confirmação, e só confirma quando p_confirmar", () => {
    expect(f).toContain("p_valor IS NULL OR p_valor < 0 OR p_valor > 1000000000");
    expect(f).toContain("p_confirmar IS NULL");
    expect(f).toContain("p_valor = 0 AND p_codigo <> 'outros_fixos_admin_mes'");
    expect(f).toMatch(/confirmado_em = CASE WHEN p_confirmar THEN now\(\) ELSE NULL END/);
    expect(f).toMatch(/confirmado_por = CASE WHEN p_confirmar THEN v_quem ELSE NULL END/);
    expect(f).toContain("v_quem := (SELECT u.id FROM public.usuarios u WHERE u.id = v_uid);");
  });

  it("só toca em custos_tabela, pela linha achada, e zera a marca no fim", () => {
    const updates = [...f.matchAll(/UPDATE\s+(public\.\w+)/g)].map((m) => m[1]);
    expect(updates).toEqual(["public.custos_tabela"]);
    expect(f).toMatch(/WHERE id = v_id;/);
    expect(f).toContain("set_config('bex.custo_sem_confirmar', CASE WHEN p_confirmar THEN '' ELSE v_id::text END, true)");
    expect(f).toContain("PERFORM set_config('bex.custo_sem_confirmar', '', true);");
  });

  it("REVOKE de PUBLIC, anon, authenticated e service_role antes do GRANT só para authenticated", () => {
    const rev = "REVOKE ALL ON FUNCTION public.confirmar_custo_fixo(text, numeric, boolean) FROM PUBLIC, anon, authenticated, service_role;";
    const grant = "GRANT EXECUTE ON FUNCTION public.confirmar_custo_fixo(text, numeric, boolean) TO authenticated;";
    expect(codigo).toContain(rev);
    expect(codigo).toContain(grant);
    expect(codigo.indexOf(rev)).toBeLessThan(codigo.indexOf(grant));
    expect(codigo).not.toMatch(/GRANT[^;]*\b(anon|PUBLIC|service_role)\b/);
    const c = codigo.slice(codigo.indexOf("DO $confere$"));
    expect(c).toContain("has_function_privilege('anon', 'public.confirmar_custo_fixo");
    expect(c).toContain("prosecdef");
  });
});

describe("custos_tabela_log trocada na definição viva", () => {
  const velho = corpoDa(sql100, "custos_tabela_log");
  const novo = corpoDa(sql, "custos_tabela_log");

  it("o guarda confere o md5 do corpo escrito na 100000, e esse número é o do arquivo", () => {
    const m = /IS DISTINCT FROM '([0-9a-f]{32})'/.exec(codigo.slice(codigo.indexOf("DO $guarda$")));
    expect(m).not.toBeNull();
    expect(m![1]).toBe(md5(velho));
  });

  it("o corpo novo é o antigo mais a exceção por linha, sem perder o histórico nem a confirmação por mudança", () => {
    expect(novo).toContain("current_setting('bex.custo_sem_confirmar', true), '') = NEW.id::text");
    expect(novo).toContain("INSERT INTO public.custos_tabela_historico");
    expect(novo).toContain("ELSIF NEW.confirmado_em IS NOT DISTINCT FROM OLD.confirmado_em THEN");
    expect(novo).toContain("NEW.confirmado_por := COALESCE(v_quem, NEW.confirmado_por);");
    // tirando as duas partes novas, sobra o corpo antigo
    const volta = novo
      .replace("\n  v_sem_confirmar boolean := COALESCE(current_setting('bex.custo_sem_confirmar', true), '') = NEW.id::text;", "")
      .replace("    IF v_sem_confirmar THEN\n      NEW.confirmado_em := NULL;\n      NEW.confirmado_por := NULL;\n    ELSIF NEW.confirmado_em IS NOT DISTINCT FROM OLD.confirmado_em THEN",
               "    IF NEW.confirmado_em IS NOT DISTINCT FROM OLD.confirmado_em THEN");
    expect(volta).toBe(velho);
  });

  it("a função segue SECURITY DEFINER com search_path fixo e o gatilho continua só BEFORE UPDATE (NEW sempre existe)", () => {
    const cab = sql.slice(sql.indexOf("FUNCTION public.custos_tabela_log()"), sql.indexOf("$function$"));
    expect(cab).toContain("SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
    expect(codigo).not.toMatch(/CREATE\s+TRIGGER\s+trg_custos_tabela_log/i);
  });
});

describe("a tela usa a função nos dois botões", () => {
  it("salvar e confirmar e salvar sem confirmar passam p_confirmar", () => {
    expect(tela).toContain('banco.rpc("confirmar_custo_fixo"');
    expect(tela).toContain("p_confirmar: v.confirmar");
    expect(tela).toContain("p_valor: v.valor");
  });

  it("não há UPDATE direto em custos_tabela na tela", () => {
    expect(tela).not.toMatch(/\.update\(/);
    expect(tela).not.toMatch(/\.from\("custos_tabela"\)\s*\.update/);
  });

  it("o botão de editar depende só de custos.fixos.update", () => {
    expect(tela).toContain('hasPermission("custos.fixos.update")');
    expect(tela).not.toContain('hasPermission("custos.update")');
  });
});

describe("roteiro e resultado do ensaio no documento", () => {
  const blocos = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
  const ensaio = blocos.find((b) => b.includes("ENSAIO OK"))!;

  it("diz que foi ensaiada e desfeita, na ordem das três, e que não foi aplicada", () => {
    expect(doc).toContain("desfeita por RAISE EXCEPTION");
    expect(doc).toContain("NÃO aplicada");
    expect(doc).toContain("100000, 110000, 120000");
    expect(doc).toContain("20261116120000_custos_fixos_do_financeiro.sql");
  });

  it("o roteiro termina em RAISE EXCEPTION, nunca em COMMIT, e simula os quatro papéis", () => {
    expect(ensaio).toBeDefined();
    expect(ensaio).toMatch(/RAISE EXCEPTION E'ENSAIO OK, DESFEITO/);
    expect(ensaio).not.toMatch(/\bCOMMIT\b/);
    for (const papel of ["'admin'", "'gestor'", "'financeiro'", "'vendedor'"]) expect(ensaio).toContain(papel);
    expect(ensaio).toContain("SET LOCAL ROLE authenticated");
    expect(ensaio).toContain("SET LOCAL ROLE anon");
    expect(ensaio).toContain("request.jwt.claim.sub");
  });

  it("prova que preço e orçamento não mudam e que o vendedor é recusado", () => {
    expect(doc).toMatch(/produtos \(preco_base, preco_parceiro, preco_publico, preco_minimo\): IGUAL/);
    expect(doc).toMatch(/orcamento_itens inteiras: IGUAL/);
    expect(doc).toContain("[2] vendedor confirmar_custo_fixo: P0001 Permissão necessária: custos.fixos.update");
    expect(doc).toContain("anon confirmar_custo_fixo: 42501");
    expect(doc).toContain("custos.fixos.update=true custos.update=false");
  });

  it("prova o 'não confirma sozinho' e a ordem com a versão antiga por cima", () => {
    expect(doc).toMatch(/confirmado_em nulo=true confirmado_por nulo=true/);
    expect(doc).toContain("md5 volta ao mesmo=true definicoes=1");
  });
});
