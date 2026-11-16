import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Custo real do produto (16/11/2026): o contrato da migração e do roteiro de ensaio, lidos como TEXTO (nada aqui
 * fala com banco). O que o SQL faz de verdade foi provado no banco vivo, dentro de uma transação desfeita, e está em
 * docs/ensaio-custo-real.md.
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const NOME = "20261116100000_custo_real_do_produto.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const doc = readFileSync(join(RAIZ, "docs", "ensaio-custo-real.md"), "utf8");

const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigo = semComentarios(sql);

/** O corpo de uma função: entre o primeiro delimitador depois do nome e o que fecha. */
function corpoDe(nome: string): string {
  const i = codigo.indexOf(`FUNCTION public.${nome}(`);
  if (i < 0) throw new Error(`sem ${nome}`);
  const m = /\$(\w*)\$/.exec(codigo.slice(codigo.indexOf("AS $", i)));
  const delim = `$${m![1]}$`;
  const ini = codigo.indexOf(delim, i) + delim.length;
  return codigo.slice(ini, codigo.indexOf(delim, ini));
}

describe("migração: arquivo e escopo", () => {
  it("vem depois da última migração anterior e o prefixo de data é único", () => {
    const todas = readdirSync(PASTA).filter((f) => f.endsWith(".sql"));
    const antes = todas.filter((f) => f !== NOME && f < NOME);
    expect(antes.length).toBeGreaterThan(0);
    expect(todas.filter((f) => f.startsWith("20261116100000_"))).toEqual([NOME]);
  });

  it("é uma transação só e confere o corpo vivo pelo md5 antes de trocar", () => {
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(codigo).toMatch(/COMMIT;\s*$/);
    expect(codigo).toContain("849742afd482caf421f1b72200381f23");
    expect(codigo).toContain("2c6b8d76e3035e7f3d0522fdbc0eafd2");
  });

  it("não mexe em preço nem em orçamento gravado", () => {
    expect(codigo).not.toMatch(/UPDATE\s+public\.produtos\b/i);
    expect(codigo).not.toMatch(/UPDATE\s+public\.produto_precos\b/i);
    expect(codigo).not.toMatch(/UPDATE\s+public\.orcamento/i);
    expect(codigo).not.toMatch(/(INSERT\s+INTO|DELETE\s+FROM)\s+public\.(orcamento|produtos|produto_precos|itens_os)/i);
    expect(codigo).not.toMatch(/\bpreco_base\s*=/i);
  });

  it("não troca desconto_avaliar, meta_por_produto nem a view produto_custo_cheio", () => {
    expect(codigo).not.toMatch(/FUNCTION public\.desconto_avaliar/);
    expect(codigo).not.toMatch(/FUNCTION public\.meta_por_produto/);
    expect(codigo).not.toMatch(/VIEW public\.produto_custo_cheio\b/);
    expect(codigo).not.toMatch(/FUNCTION public\.sincronizar_precificacao_do_produto/);
  });
});

describe("custos_tabela: parâmetros e confirmação", () => {
  it("colunas aditivas e valor opcional", () => {
    expect(codigo).toMatch(/ALTER COLUMN valor DROP NOT NULL/);
    expect(codigo).toMatch(/ADD COLUMN IF NOT EXISTS confirmado_por uuid REFERENCES public\.usuarios\(id\) ON DELETE SET NULL/);
    expect(codigo).toMatch(/ADD COLUMN IF NOT EXISTS confirmado_em timestamptz/);
  });

  it("os 9 códigos do contrato nascem numa instrução só, e só o aluguel tem número", () => {
    const ins = codigo.slice(codigo.indexOf("INSERT INTO public.custos_tabela"), codigo.indexOf("UPDATE public.custos_tabela\n   SET valor = 32.82"));
    const codigos = [
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
    for (const c of codigos) expect(ins).toContain(`'${c}'`);
    expect((codigo.match(/INSERT INTO public\.custos_tabela \(/g) ?? []).length).toBe(1);
    expect(ins).toMatch(/'aluguel_espaco_mensal', 'Aluguel do espaço', 'R\$\/mês', 2000,/);
    expect((ins.match(/, NULL,\n/g) ?? []).length).toBe(8);
  });

  it("as linhas antigas nascem confirmadas e o gatilho de recomposição só olha valor e ativo", () => {
    expect(codigo).toMatch(/UPDATE public\.custos_tabela SET confirmado_em = now\(\) WHERE confirmado_em IS NULL;/);
    expect(codigo).toMatch(/AFTER INSERT OR DELETE OR UPDATE OF valor, ativo ON public\.custos_tabela/);
  });

  it("custos_tabela_log segue SECURITY DEFINER e mudar o número confirma", () => {
    const c = corpoDe("custos_tabela_log");
    expect(codigo).toMatch(/FUNCTION public\.custos_tabela_log\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path TO 'public'/);
    expect(c).toContain("custos_tabela_historico");
    expect(c).toMatch(/NEW\.confirmado_em := now\(\)/);
    expect(c).toMatch(/NEW\.valor IS NULL/);
  });
});

describe("aluguel dentro do rateio", () => {
  it("custo_admin_hora é derivado de (aluguel + outros) / horas e nunca recebe o aluguel por cima", () => {
    const c = corpoDe("tg_custos_rateio_admin_hora");
    expect(c).toMatch(/\(v_aluguel \+ COALESCE\(v_outros, 0\)\) \/ v_horas/);
    expect(c).toMatch(/aluguel_espaco_mensal' AND confirmado_em IS NOT NULL/);
    expect(c).toMatch(/IF COALESCE\(v_aluguel, 0\) <= 0 THEN RETURN NULL/);
    expect(c).toMatch(/WHERE codigo = 'custo_admin_hora'/);
    expect(codigo).toMatch(/WHEN \(NEW\.codigo IN \('aluguel_espaco_mensal', 'outros_fixos_admin_mes', 'plotter_horas_mes_reais'\)\)/);
    // custo_cheio_do_produto continua lendo UMA linha e não soma o aluguel
    const f = corpoDe("custo_cheio_do_produto");
    expect(f).not.toContain("aluguel_espaco_mensal");
    expect(f).toMatch(/codigo = 'custo_admin_hora'/);
  });

  it("o gatilho de rateio é privado", () => {
    expect(codigo).toMatch(/REVOKE ALL ON FUNCTION public\.tg_custos_rateio_admin_hora\(\) FROM PUBLIC, anon, authenticated;/);
  });
});

describe("salário e encargos", () => {
  it("encargos de 32,19 para 32,82 nas duas tabelas, com a rescisão em 3,82", () => {
    expect(codigo).toMatch(/SET valor = 32\.82[\s\S]*?WHERE codigo = 'mo_encargos_pct' AND valor = 32\.19/);
    expect(codigo).toMatch(/SET encargos_pct = 0\.3282[\s\S]*?WHERE ativo AND encargos_pct = 0\.3219/);
    expect(sql).toContain("rescisão provisionada 3,82");
    expect(8 + 8.33 + 11.11 + 1.56 + 3.82).toBeCloseTo(32.82, 6);
    expect(1621 / 176 * 1.3282).toBeCloseTo(12.233, 3);
  });
});

describe("máquinas: velocidade usada separada da nominal", () => {
  it("colunas novas, GRANT só nelas e só para authenticated, e só a i1600 recebe valor", () => {
    expect(codigo).toMatch(/ADD COLUMN IF NOT EXISTS velocidade_calculo_m2_h numeric/);
    expect(codigo).toMatch(/ADD COLUMN IF NOT EXISTS velocidade_calculo_texto text/);
    expect(codigo).toMatch(/GRANT SELECT \(velocidade_calculo_m2_h, velocidade_calculo_texto\) ON public\.maquinas TO authenticated;/);
    expect(codigo).not.toMatch(/GRANT SELECT ON public\.maquinas\b/);
    const up = codigo.slice(codigo.indexOf("UPDATE public.maquinas"), codigo.indexOf("DROP TRIGGER IF EXISTS tg_maquina_recompoe_custos"));
    expect(up).toMatch(/velocidade_calculo_m2_h = 10/);
    expect(up).toMatch(/WHERE id = 'b77ec8f1-f336-4433-9b49-03c34db4183e' AND nome ILIKE '%i1600%'/);
    expect(up).toContain("14 m² por hora no catálogo");
    expect(up).toContain("10 m² por hora");
    expect((codigo.match(/UPDATE public\.maquinas/g) ?? []).length).toBe(1);
    expect(codigo).not.toMatch(/SET\s+velocidade_m2_h\b/);
  });

  it("o gatilho de máquina reage à velocidade", () => {
    expect(codigo).toMatch(/UPDATE OF custo_hora, velocidade_m2_h, velocidade_calculo_m2_h ON public\.maquinas/);
  });
});

describe("custo_cheio_do_produto trocada na definição viva", () => {
  const f = corpoDe("custo_cheio_do_produto");

  it("mantém os atributos da função original", () => {
    expect(codigo).toMatch(/FUNCTION public\.custo_cheio_do_produto\(p_produto_id uuid\)\s+RETURNS jsonb\s+LANGUAGE plpgsql\s+STABLE SECURITY DEFINER\s+SET search_path TO 'public'/);
    expect(codigo).toMatch(/REVOKE ALL ON FUNCTION public\.custo_cheio_do_produto\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(codigo).toMatch(/GRANT EXECUTE ON FUNCTION public\.custo_cheio_do_produto\(uuid\) TO service_role;/);
  });

  it("usa a velocidade de cálculo com a nominal como reserva", () => {
    expect(f).toMatch(/COALESCE\(NULLIF\(v_vel_calculo, 0\), v_vel_nominal\)/);
    expect(f).toContain("velocidade_usada_m2_h");
    expect(f).toContain("velocidade_nominal_m2_h");
  });

  it("perda e falha são divisor sobre material de ficha", () => {
    expect(f).toMatch(/IF v_tem_ficha AND v_material > 0 THEN/);
    expect(f).toMatch(/pct_perda_material/);
    expect(f).toMatch(/pct_falha_producao/);
    expect(f).toMatch(/v_perdas := v_material \/ v_div - v_material/);
    expect(f).toMatch(/v_div := 1 - LEAST\(GREATEST\(\(v_pct_perda \+ v_pct_falha\) \/ 100\.0, 0\), 0\.9\)/);
    // 8 mais 5 de 100: o divisor é 0,87, não 1,13 nem 0,92
    const div = 1 - (8 + 5) / 100;
    expect(100 / div - 100).toBeCloseTo(14.9425, 3);
  });

  it("extras da plotter valem zero enquanto vazios e custo_total mantém o significado antigo", () => {
    expect(f).toMatch(/COALESCE\(v_manut, 0\) \+ COALESCE\(v_limpeza, 0\)/);
    expect(f).toMatch(/COALESCE\(v_cab_custo, 0\) > 0 AND COALESCE\(v_cab_vida, 0\) > 0/);
    expect(f).toMatch(/'custo_total', round\(v_material \+ v_maquina \+ v_mao \+ v_indireto, 4\)/);
    expect(f).toMatch(/'custo_producao', round\(v_material \+ v_maquina \+ v_mao \+ v_indireto \+ v_perdas \+ v_extra, 4\)/);
    for (const k of ["sem_tinta", "material_sem_custo", "sem_mao_de_obra", "custo_incompleto", "tempo_presumido"]) {
      expect(f).toContain(`'${k}'`);
    }
  });

  it("o texto do critério não usa parênteses, travessão nem seta", () => {
    const criterios = [...f.matchAll(/v_criterio := ([^;]+);/g)].map((m) => m[1]);
    expect(criterios.length).toBeGreaterThan(0);
    for (const c of criterios) {
      const literais = [...c.matchAll(/'([^']*)'/g)].map((m) => m[1]).join(" ");
      expect(literais).not.toMatch(/[()—→×]/);
    }
    expect(sql).not.toMatch(/velocidade_calculo_texto = '[^']*[()—→]/);
  });
});

describe("view produto_custo_real", () => {
  const v = codigo.slice(codigo.indexOf("CREATE OR REPLACE VIEW public.produto_custo_real"), codigo.indexOf("COMMENT ON VIEW public.produto_custo_real"));

  it("é security_invoker e só o service_role lê", () => {
    expect(v).toMatch(/WITH \(security_invoker = true\)/);
    expect(codigo).toMatch(/REVOKE ALL ON public\.produto_custo_real FROM PUBLIC, anon, authenticated;/);
    expect(codigo).toMatch(/GRANT SELECT ON public\.produto_custo_real TO service_role;/);
    expect(codigo).not.toMatch(/GRANT SELECT ON public\.produto_custo_real TO (anon|authenticated|PUBLIC)/);
  });

  it("tem as colunas do contrato, na ordem", () => {
    const ordem = [
      "produto_id",
      "nome",
      "familia",
      "preco_balcao",
      "custo_producao",
      "custo_real",
      "margem_liquida_pct",
      "vezes_o_custo",
      "preco_regra_de_tres",
      "sem_tinta",
      "material_sem_custo",
      "sem_mao_de_obra",
      "custo_incompleto",
      "velocidade_usada_m2_h",
      "velocidade_nominal_m2_h",
      "tempo_presumido",
      "parceiro_abaixo_do_piso",
    ];
    const select = v.slice(v.lastIndexOf("SELECT c.produto_id"));
    let pos = -1;
    for (const col of ordem) {
      const re = new RegExp(`(AS ${col}\\b|c\\.${col},)`);
      const m = re.exec(select.slice(pos + 1));
      expect(m, col).not.toBeNull();
      pos = pos + 1 + m!.index;
    }
  });

  it("custo real divide o custo pelas taxas de desconto_avaliar e a margem é coerente", () => {
    expect(v).toMatch(/impostos_venda/);
    expect(v).toMatch(/taxa_cartao'\), 0\) \/ 2\) \/ 100/);
    expect(v).toMatch(/\/ \(1 - b\.t\), 2\) AS custo_real/);
    expect(v).toMatch(/round\(\(1 - c\.custo_real \/ c\.preco_balcao\) \* 100, 2\)/);
    expect(v).toMatch(/round\(c\.custo_real \* 3, 2\) AS preco_regra_de_tres/);
    expect(v).toMatch(/WHERE p\.ativo AND COALESCE\(pr\.preco_base, 0\) > 0/);
    const taxa = (6 + 3.5 / 2) / 100;
    expect(taxa).toBeCloseTo(0.0775, 6);
    expect(1 - 20 / 0.9225 / 100).toBeLessThan(1);
  });
});

describe("pendencias_de_custo: uma dona só", () => {
  const lembrete = readFileSync(join(PASTA, "20261116110000_lembrete_diario_de_custos.sql"), "utf8");
  const lembreteCodigo = semComentarios(lembrete);

  it("esta migração não define, não revoga nem concede a função", () => {
    expect(codigo).not.toMatch(/pendencias_de_custo/);
    expect(sql).toMatch(/NÃO é definida aqui/);
  });

  it("a definição final, só para service_role, mora na migração do lembrete", () => {
    expect(lembreteCodigo).toMatch(/FUNCTION public\.pendencias_de_custo\(\)\s*RETURNS TABLE \(codigo text, rotulo text, tipo text\)/);
    expect(lembreteCodigo).toMatch(/REVOKE ALL ON FUNCTION public\.pendencias_de_custo\(\) FROM PUBLIC, anon, authenticated, service_role;/);
    expect(lembreteCodigo).toMatch(/GRANT EXECUTE ON FUNCTION public\.pendencias_de_custo\(\) TO service_role;/);
    expect(lembreteCodigo).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.pendencias_de_custo\(\) TO (anon|authenticated|PUBLIC)/);
    expect([...lembreteCodigo.matchAll(/CREATE OR REPLACE FUNCTION public\.pendencias_de_custo\(/g)]).toHaveLength(1);
  });

  it("nenhuma outra migração do repositório redefine a função", () => {
    const donas = readdirSync(PASTA)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => /CREATE (OR REPLACE )?FUNCTION public\.pendencias_de_custo\(/.test(semComentarios(readFileSync(join(PASTA, f), "utf8"))));
    expect(donas).toEqual(["20261116110000_lembrete_diario_de_custos.sql"]);
  });

  it("a definição final lista parâmetro, material em uso e parceiro abaixo do piso, sem custo em reais", () => {
    expect(lembreteCodigo).toContain("'parametro'::text AS tipo");
    expect(lembreteCodigo).toContain("'material'::text AS tipo");
    expect(lembreteCodigo).toContain("'parceiro'::text AS tipo");
    expect(lembreteCodigo).toMatch(/pr?\.ativo|p\.ativo/);
    expect(lembreteCodigo).not.toMatch(/custo_real::text|custo_producao::text|c\.valor::text/);
  });

  it("a ordem 100000, 110000, 120000 está escrita nos cabeçalhos", () => {
    expect(sql).toContain("20261116110000");
    expect(lembrete).toContain("ORDEM DE APLICACAO: 20261116100000, depois esta, depois 20261116120000");
  });
});

describe("roteiro de ensaio no documento", () => {
  it("diz que foi ensaiada e desfeita, e que não foi aplicada", () => {
    expect(doc).toContain("desfeita por RAISE EXCEPTION");
    expect(doc).toContain("NÃO aplicada");
    expect(doc).toContain("20261116100000_custo_real_do_produto.sql");
  });

  it("prova que preço e itens de orçamento não mudam", () => {
    expect(doc).toMatch(/70 produtos, hash por id \| IGUAL/);
    expect(doc).toMatch(/156 linhas inteiras[\s\S]*?IGUAL/);
  });

  it("lista os consumidores e os orçamentos abertos afetados", () => {
    for (const c of ["desconto_avaliar", "meta_por_produto", "sincronizar_precificacao_do_produto", "ponto_de_equilibrio"]) {
      expect(doc).toContain(c);
    }
    expect(doc).toMatch(/42 orçamentos, 15 rascunhos e 27 enviados/);
    expect(doc).toMatch(/\*\*Alçada mudou\*\*[^|]*\| \*\*0\*\*/);
  });

  it("o bloco SQL do roteiro termina em RAISE EXCEPTION", () => {
    const blocos = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
    const ensaio = blocos.find((b) => b.includes("ENSAIO OK"));
    expect(ensaio).toBeDefined();
    expect(ensaio).toMatch(/RAISE EXCEPTION E'ENSAIO OK, DESFEITO/);
  });

  it("a visão do custo das máquinas ganha as colunas novas, no fim, mantendo as opções de segurança", () => {
    const m = codigo.match(/CREATE OR REPLACE VIEW public\.maquinas_financeiro WITH \(([^)]*)\) AS([\s\S]*?);/);
    expect(m, "maquinas_financeiro recriada").not.toBeNull();
    expect(m![1]).toMatch(/security_barrier\s*=\s*true/);
    expect(m![1]).toMatch(/security_invoker\s*=\s*false/);
    expect(m![2]).toMatch(/comprimento_util_m,\s*velocidade_calculo_m2_h,\s*velocidade_calculo_texto\s+FROM public\.maquinas m/);
    expect(m![2]).toContain("pode_ver_custo_de_maquina");
  });
});
