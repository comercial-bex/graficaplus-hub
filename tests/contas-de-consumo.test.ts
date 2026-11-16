import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  avisoDeDuplicidade,
  competenciaDe,
  faturaDaCompetencia,
  faturaEmFalta,
  nomeDaUnidade,
  numeroDoCampo,
  problemaDoLancamento,
  rotuloDaCompetencia,
  serieDe12Meses,
  somarMeses,
  textoDaVariacao,
  variacaoContraAnterior,
  vencimentoNoMes,
  type FaturaDeConsumo,
  type UnidadeDeConsumo,
} from "../src/domain/financeiro/contas-de-consumo";

const RAIZ = join(__dirname, "..");
const ler = (f: string) => readFileSync(join(RAIZ, f), "utf8");
const SQL = ler("supabase/migrations/20261116220000_contas_de_consumo.sql");
/** O que a migração executa ao ser aplicada: sem comentários e sem os corpos das funções. */
const EXECUTAVEL = SQL.replace(/AS \$function\$[\s\S]*?\$function\$/g, "")
  .replace(/DO \$\w+\$[\s\S]*?END \$\w+\$;/g, "")
  .replace(/^--.*$/gm, "");
const corpo = (f: string) => {
  const m = SQL.match(
    new RegExp(`FUNCTION public\\.${f}\\([\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$`),
  );
  expect(m, f).not.toBeNull();
  return m![1];
};

const CEA: UnidadeDeConsumo = {
  id: "u1",
  tipo: "energia",
  fornecedor_id: "f1",
  identificador: "228.739.007-85",
  endereco: null,
  dia_vencimento: 7,
  conta_bancaria_id: "itau",
  observacoes: null,
  ativo: true,
  fornecedores: { nome: "CEA", razao_social: "COMPANHIA DE ELETRICIDADE DO AMAPA CEA" },
};

const fatura = (
  competencia: string,
  valor: number,
  vencimento: string,
  o: Partial<FaturaDeConsumo> = {},
): FaturaDeConsumo => ({
  conta_pagar_id: `c-${competencia}`,
  unidade_id: "u1",
  competencia,
  consumo: null,
  bandeira_taxas: null,
  iluminacao_publica: null,
  numero_nf: null,
  contas_pagar: {
    id: `c-${competencia}`,
    descricao: `Energia CEA — UC 228.739.007-85 — competência ${rotuloDaCompetencia(competencia)}`,
    fornecedor: "COMPANHIA DE ELETRICIDADE DO AMAPA CEA",
    valor,
    vencimento,
    status: "aberta",
    data_pagamento: null,
    comprovante_url: null,
  },
  ...o,
});
const SETEMBRO = fatura("2026-09-01", 731.46, "2026-10-07", {
  contas_pagar: {
    ...fatura("2026-09-01", 731.46, "2026-10-07").contas_pagar!,
    status: "paga",
    data_pagamento: "2026-11-16",
  },
});

describe("competência e rótulos", () => {
  it("competência é sempre o dia 1; rótulo é MM/AAAA; meses viram o ano", () => {
    expect(competenciaDe("2026-10")).toBe("2026-10-01");
    expect(competenciaDe("2026-10-15")).toBe("2026-10-01");
    expect(rotuloDaCompetencia("2026-09-01")).toBe("09/2026");
    expect(somarMeses("2026-01-01", -1)).toBe("2025-12-01");
    expect(somarMeses("2026-11-01", 2)).toBe("2027-01-01");
    expect(nomeDaUnidade(CEA)).toBe("Energia · CEA · UC 228.739.007-85");
  });

  it("número do campo aceita vírgula brasileira e milhar com ponto", () => {
    expect(numeroDoCampo("1.234,56")).toBe(1234.56);
    expect(numeroDoCampo("731.46")).toBe(731.46);
    expect(numeroDoCampo(" ")).toBeNull();
    expect(numeroDoCampo("abc")).toBeNaN();
  });

  it("dia 31 em fevereiro vence no último dia do mês", () => {
    expect(vencimentoNoMes(31, "2027-02-10")).toBe("2027-02-28");
    expect(vencimentoNoMes(7, "2026-11-16")).toBe("2026-11-07");
  });
});

describe("duplicidade", () => {
  it("a tela diz a mesma frase que o banco recusa, com a fatura que já existe", () => {
    expect(faturaDaCompetencia([SETEMBRO], "u1", "2026-09")).toBe(SETEMBRO);
    expect(faturaDaCompetencia([SETEMBRO], "u1", "2026-10")).toBeUndefined();
    expect(faturaDaCompetencia([SETEMBRO], "outra", "2026-09")).toBeUndefined();
    expect(avisoDeDuplicidade(SETEMBRO)).toBe(
      "Já existe a fatura de 09/2026 desta unidade: R$ 731,46, vencimento 07/10/2026, paga em 16/11/2026.",
    );
    // A mesma frase, montada pelo banco (o ensaio no banco vivo confere a string inteira).
    expect(corpo("lancar_fatura_consumo")).toContain(
      "'Já existe a fatura de % desta unidade: R$ %, vencimento %, %.'",
    );
  });

  it("lançar pede competência, vencimento, valor e o PDF, e recusa mês que não começou", () => {
    const ok = { competencia: "2026-10", vencimento: "2026-11-07", valor: "812,35", temPdf: true };
    expect(problemaDoLancamento(ok, "2026-11-16")).toBeNull();
    expect(problemaDoLancamento({ ...ok, competencia: "" }, "2026-11-16")).toMatch(/competência/);
    expect(problemaDoLancamento({ ...ok, competencia: "2026-12" }, "2026-11-16")).toMatch(
      /não começou/,
    );
    expect(problemaDoLancamento({ ...ok, vencimento: "" }, "2026-11-16")).toMatch(/vencimento/);
    expect(problemaDoLancamento({ ...ok, valor: "0" }, "2026-11-16")).toMatch(/valor/);
    expect(problemaDoLancamento({ ...ok, temPdf: false }, "2026-11-16")).toMatch(/PDF/);
  });
});

describe("acompanhamento", () => {
  it("falta a fatura do mês a partir de 5 dias antes do dia habitual, até alguma vencer no mês", () => {
    expect(faturaEmFalta(CEA, [SETEMBRO], "2026-11-16")).toEqual({
      vencimentoEsperado: "2026-11-07",
      competenciaProvavel: "2026-10-01",
    });
    expect(faturaEmFalta(CEA, [SETEMBRO], "2026-11-01")).toBeNull(); // 6 dias antes
    expect(faturaEmFalta(CEA, [SETEMBRO], "2026-11-02")).not.toBeNull(); // 5 dias antes
    const outubro = fatura("2026-10-01", 812.35, "2026-11-07");
    expect(faturaEmFalta(CEA, [SETEMBRO, outubro], "2026-11-16")).toBeNull();
    expect(faturaEmFalta({ ...CEA, ativo: false }, [SETEMBRO], "2026-11-16")).toBeNull();
    expect(faturaEmFalta({ ...CEA, dia_vencimento: null }, [SETEMBRO], "2026-11-16")).toBeNull();
  });

  it("12 meses até o mês de hoje, com vazio onde não há fatura", () => {
    const outubro = fatura("2026-10-01", 812.35, "2026-11-07", { consumo: 1234.5 });
    const s = serieDe12Meses([outubro, SETEMBRO], "2026-11-16");
    expect(s).toHaveLength(12);
    expect(s[0].rotulo).toBe("12/2025");
    expect(s[11].rotulo).toBe("11/2026");
    expect(s[9]).toEqual({
      competencia: "2026-09-01",
      rotulo: "09/2026",
      valor: 731.46,
      consumo: null,
    });
    expect(s[10]).toEqual({
      competencia: "2026-10-01",
      rotulo: "10/2026",
      valor: 812.35,
      consumo: 1234.5,
    });
    expect(s[11].valor).toBeNull();
  });

  it("variação contra o mês anterior, só com meses seguidos", () => {
    const set = fatura("2026-09-01", 700, "2026-10-07", { consumo: 1000 });
    const out = fatura("2026-10-01", 777, "2026-11-07", { consumo: 950 });
    expect(variacaoContraAnterior([set, out])).toEqual({
      atual: "10/2026",
      anterior: "09/2026",
      valorPct: 11,
      consumoPct: -5,
    });
    expect(variacaoContraAnterior([out])).toBeNull();
    expect(variacaoContraAnterior([fatura("2026-08-01", 1, "2026-09-07"), out])).toBeNull();
    expect(
      variacaoContraAnterior([SETEMBRO, fatura("2026-10-01", 812.35, "2026-11-07")])?.consumoPct,
    ).toBeNull();
    expect(textoDaVariacao(11)).toBe("+11,0%");
    expect(textoDaVariacao(-5)).toBe("−5,0%");
    expect(textoDaVariacao(null)).toBe("sem dado");
  });
});

describe("migração 20261116220000", () => {
  it("o md5 anotado no cabeçalho é o do corpo no arquivo (retrato do que foi aplicado)", async () => {
    const { createHash } = await import("node:crypto");
    const anotados = new Map(
      [...SQL.matchAll(/^--\s+(\w+)\s+([0-9a-f]{32})\b/gm)].map((m) => [m[1], m[2]]),
    );
    expect(anotados.size).toBe(2);
    for (const [f, md5] of anotados)
      expect(createHash("md5").update(corpo(f), "utf8").digest("hex"), f).toBe(md5);
  });

  it("só acrescenta: não altera tabela, policy nem função que já existe", () => {
    expect(EXECUTAVEL).not.toMatch(
      /ALTER TABLE public\.(contas_pagar|caixa_movimentos|compromissos_financeiros|reembolsos|contas_bancarias|fornecedores|banco_transacoes)\b/,
    );
    expect(EXECUTAVEL).not.toMatch(/\bDROP\b|TRUNCATE|CREATE (OR REPLACE )?VIEW/i);
    expect(EXECUTAVEL).not.toMatch(/^\s*(UPDATE|DELETE)\b/im);
    const politicas = [...EXECUTAVEL.matchAll(/CREATE POLICY "[^"]+" ON public\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(new Set(politicas)).toEqual(new Set(["unidades_consumo", "faturas_consumo"]));
    const funcoes = [...SQL.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(funcoes.sort()).toEqual(["corrigir_dados_fatura_consumo", "lancar_fatura_consumo"]);
    // Dados: só INSERT, e só em fornecedores e nas tabelas novas.
    const dados = SQL.slice(SQL.indexOf("DO $dados$"), SQL.indexOf("END $dados$"));
    expect([...dados.matchAll(/INSERT INTO public\.(\w+)/g)].map((m) => m[1]).sort()).toEqual([
      "faturas_consumo",
      "fornecedores",
      "unidades_consumo",
    ]);
    expect(dados).not.toMatch(/\bUPDATE\b|\bDELETE\b/);
  });

  it("unidade: lê quem vê o financeiro; cria e edita só admin e gestor; ninguém apaga", () => {
    const pol = (nome: string) => {
      const m = SQL.match(new RegExp(`CREATE POLICY "${nome}"[\\s\\S]*?;`));
      expect(m, nome).not.toBeNull();
      return m![0].replace(/\s+/g, " ");
    };
    expect(pol("unidades de consumo: quem ve o financeiro le")).toContain("FOR SELECT");
    expect(pol("unidades de consumo: quem ve o financeiro le")).toContain("can_see_financials");
    for (const p of [
      "unidades de consumo: so admin e gestor cadastram",
      "unidades de consumo: so admin e gestor editam",
    ]) {
      expect(pol(p)).toContain("'admin'::public.app_role");
      expect(pol(p)).toContain("'gestor'::public.app_role");
      expect(pol(p)).not.toMatch(/financeiro|has_permission|can_see_financials/);
    }
    expect(SQL).toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.unidades_consumo TO authenticated;",
    );
    expect(SQL).not.toMatch(/GRANT[^;]*DELETE[^;]*unidades_consumo/);
    expect(SQL).toContain("lower(regexp_replace(identificador, '[^0-9A-Za-z]', '', 'g'))");
  });

  it("fatura: uma por unidade e competência; grava só por função; apagar a conta leva a fatura", () => {
    expect(SQL).toContain(
      "CONSTRAINT faturas_consumo_unidade_competencia_key UNIQUE (unidade_id, competencia)",
    );
    expect(SQL).toContain("REFERENCES public.contas_pagar(id) ON DELETE CASCADE");
    expect(SQL).toContain("GRANT SELECT ON TABLE public.faturas_consumo TO authenticated;");
    expect(SQL).not.toMatch(/GRANT[^;]*(INSERT|UPDATE)[^;]*faturas_consumo TO authenticated/);
  });

  it("lançar tem a porta do Nova conta a pagar; corrigir registra a recusa; anon não executa", () => {
    const l = corpo("lancar_fatura_consumo");
    expect(l).toContain("public.can_see_financials(v_uid)");
    expect(l).toContain("public.has_permission(v_uid, 'pagamentos.create')");
    expect(l).toContain(
      "INSERT INTO public.contas_pagar (descricao, fornecedor, categoria, valor, vencimento, created_by)",
    );
    expect(l).toContain("'A competência % ainda não começou.'");
    expect(corpo("corrigir_dados_fatura_consumo")).toContain("public._negar_conta_pagar(");
    for (const f of [
      "lancar_fatura_consumo(uuid, date, date, numeric, numeric, numeric, numeric, text)",
      "corrigir_dados_fatura_consumo(uuid, numeric, numeric, numeric, text)",
    ]) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`);
      expect(SQL).toContain(
        `GRANT EXECUTE ON FUNCTION public.${f} TO authenticated, service_role;`,
      );
    }
    expect(SQL).not.toMatch(/TO (anon|PUBLIC)\b/);
  });

  it("liga a conta de 09/2026 sem tocar nela, e só se ela estiver como foi conferida", () => {
    expect(SQL).toContain("id = '0e5a297c-e0db-4b0c-ae11-076377930d39'");
    expect(SQL).toMatch(
      /valor = 731\.46 AND status = 'paga'\s+AND vencimento = '2026-10-07' AND data_pagamento = '2026-11-16'/,
    );
    expect(SQL).toContain(
      "'energia', v_forn, '228.739.007-85', 7, 'd91b5d74-e754-48aa-8444-2f30ceb86eb2'",
    );
  });
});

describe("telas", () => {
  const LANCAR = ler("src/components/financeiro/contas-de-consumo/lancar-fatura-dialog.tsx");
  const DIALOGOS = ler("src/components/financeiro/contas-de-consumo/dialogos-de-consumo.tsx");
  const GANCHOS = ler("src/components/financeiro/contas-de-consumo/use-contas-de-consumo.ts");
  const PAGAR = ler("src/components/financeiro/contas-a-pagar/pagar-conta-dialog.tsx");
  const LISTA = ler("src/routes/_authenticated/contas-de-consumo.tsx");
  const UNIDADE = ler("src/routes/_authenticated/contas-de-consumo_.$id.tsx");
  const CONFERENCIA = ler("src/routes/_authenticated/conferencia-do-caixa.tsx");

  it("lançar anexa o PDF como fatura/boleto e avisa a duplicidade antes de gravar", () => {
    expect(LANCAR).toContain('tipoFixo="fatura"');
    expect(LANCAR).toContain("temPdf: pdf.length > 0");
    expect(LANCAR).toContain("faturaDaCompetencia(faturas, unidade.id, competencia)");
    expect(LANCAR).toContain("avisoDeDuplicidade(repetida)");
    expect(LANCAR).toContain("await enviar(r.contaId, pdf)");
  });

  it("'Já está paga' abre o mesmo Confirmar pagamento, com a conta habitual só como sugestão", () => {
    expect(DIALOGOS).toContain("<PagarContaDialog");
    expect(DIALOGOS).toContain("if (!f.jaPaga)");
    expect(DIALOGOS).toContain('tipo: "pagar"');
    expect(DIALOGOS).toContain("origemSugerida={dialogo.unidade?.conta_bancaria_id ?? null}");
    // A origem continua começando vazia: a sugestão só aparece com um botão.
    expect(PAGAR).toContain('const [origem, setOrigem] = useState("");');
    expect(PAGAR).toContain("onClick={() => setOrigem(sugerida.conta_id)}");
  });

  it("os ganchos tratam a recusa do banco e a edição que volta com 0 linhas", () => {
    expect(GANCHOS.match(/recusaDoBanco\(data\)/g)?.length).toBe(2);
    expect(GANCHOS).toContain("if (!salva) throw new Error");
    expect(GANCHOS).toContain('podeCadastrarUnidade: admin || hasRole("gestor")');
  });

  it("cadastrar unidade só aparece para admin e gestor; o gráfico tem um eixo por medida", () => {
    expect(LISTA).toContain("podeCadastrarUnidade && (");
    expect(UNIDADE).toContain("{podeCadastrarUnidade && (");
    expect((UNIDADE.match(/<BarChart /g) ?? []).length).toBe(1); // um componente, uma série
    expect(UNIDADE).toContain('chave="valor"');
    expect(UNIDADE).toContain('chave="consumo"');
    expect(UNIDADE).not.toMatch(/yAxisId|ComposedChart/);
  });

  it("a Conferência só ganha a etiqueta da fatura de consumo, e continua só lendo", () => {
    expect(CONFERENCIA).toContain('.from("faturas_consumo")');
    expect(CONFERENCIA).toContain("consumo.get(conta.id)");
    expect(CONFERENCIA).not.toMatch(/\.(insert|update|upsert|delete)\(|\.rpc\(|\.remove\(/);
  });

  it("aba no Caixa, porta do financeiro e as categorias novas no Nova conta a pagar", () => {
    expect(ler("src/lib/menu.ts")).toContain('aba("Contas de consumo", "/contas-de-consumo")');
    expect(ler("src/lib/permissions.ts")).toContain(
      '{ path: "/contas-de-consumo", permissions: ["financeiro.read"] }',
    );
    const fluxo = ler("src/routes/_authenticated/fluxo-caixa.tsx");
    for (const c of ['"energia"', '"agua"', '"internet"', '"telefone"', '"gas"'])
      expect(fluxo, c).toContain(c);
  });
});
