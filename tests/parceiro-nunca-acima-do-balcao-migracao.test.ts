import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O parceiro nunca paga mais que o balcão: o contrato da migração, do roteiro de ensaio e dos consumidores, lidos como TEXTO
 * (nada aqui fala com banco). A troca é refeita aqui sobre os corpos vivos de 15/11/2026, guardados em tests/apoio, e tem de dar
 * os md5 provados no banco. O que o SQL faz de verdade foi ensaiado no banco vivo, numa transação desfeita:
 * docs/ensaio-parceiro-nunca-acima-do-balcao.md.
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const NOME = "20261115170000_parceiro_nunca_paga_mais_que_o_balcao.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const doc = readFileSync(join(RAIZ, "docs", "ensaio-parceiro-nunca-acima-do-balcao.md"), "utf8");
const precosVivo = readFileSync(
  join(__dirname, "apoio", "parceiro-precos-corpo-vivo-15-11.sql.txt"),
  "utf8",
);
const simularVivo = readFileSync(
  join(__dirname, "apoio", "parceiro-simular-niveis-corpo-vivo-15-11.sql.txt"),
  "utf8",
);

const MD5_PRECOS_ANTIGO = "aa319b8b5483496d7fefe13600236525";
const MD5_PRECOS_NOVO = "0cb6ca7ec3250a628c96ba5279b70fd6";
const MD5_SIMULAR_ANTIGO = "4ef7cf3ed9e1e09f1e370812c4527906";
const MD5_SIMULAR_NOVO = "c84651dc04c958b4207c6e358075d805";

const md5 = (t: string) => createHash("md5").update(t).digest("hex");
const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigo = semComentarios(sql);

function comandosSemWhere(s: string): string[] {
  const achados: string[] = [];
  const re =
    /\b(UPDATE\s+(?:ONLY\s+)?[\w.]+\s+(?:\w+\s+)?SET\b|DELETE\s+FROM\s+(?:ONLY\s+)?[\w.]+)([\s\S]*?)(?:;|$)/gi;
  for (const m of s.matchAll(re)) {
    if (!/\bWHERE\b/i.test(m[0])) achados.push(m[0].replace(/\s+/g, " ").slice(0, 120));
  }
  return achados;
}

/** O que está entre `$tag$` e `$tag$`, na primeira vez. */
function dolar(texto: string, tag: string): string {
  const m = texto.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`));
  if (!m) throw new Error(`sem $${tag}$`);
  return m[1];
}

const vezes = (texto: string, trecho: string) => texto.split(trecho).length - 1;

const sVelho = dolar(sql, "sv");
const sNovo = dolar(sql, "sn");
const fVelho = dolar(sql, "fv");
const fNovo = dolar(sql, "fn");
const mVelho = dolar(sql, "mv");
const mNovo = dolar(sql, "mn");

const precosNovo = precosVivo.split(sVelho).join(sNovo).split(fVelho).join(fNovo);
const simularNovo = simularVivo.split(mVelho).join(mNovo);

describe("parceiro até o balcão: arquivo e escopo", () => {
  it("vem depois da última migração e o prefixo de data é único", () => {
    const outras = readdirSync(PASTA).filter((n) => n.endsWith(".sql") && n !== NOME);
    expect(outras.filter((n) => n.startsWith(NOME.slice(0, 14)))).toEqual([]);
    expect(NOME > "20261115160000_parceiro_sempre_atendido.sql").toBe(true);
  });

  it("troca DUAS funções por EXECUTE sobre a definição viva e não toca em tabela, gatilho, política, coluna nem tipo", () => {
    expect(codigo).not.toMatch(/\bDROP\b/i);
    expect(codigo).not.toMatch(/\bALTER\b/i);
    expect(codigo).not.toMatch(/\bCREATE\s+(TABLE|TRIGGER|POLICY|TYPE|INDEX|VIEW|EXTENSION)\b/i);
    expect(codigo).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(codigo).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i);
    expect([...codigo.matchAll(/^\s*EXECUTE\s/gm)]).toHaveLength(2);
    expect(sql).toContain("to_regprocedure('public.parceiro_precos(uuid)')");
    expect(sql).toContain("to_regprocedure('public.parceiro_simular_niveis(jsonb)')");
    expect(comandosSemWhere(codigo)).toEqual([]);
  });

  it("abre com BEGIN e lock_timeout curto, fecha com COMMIT depois da conferência", () => {
    const i = sql.indexOf("BEGIN;");
    const j = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    const k = sql.lastIndexOf("COMMIT;");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(k).toBeGreaterThan(sql.indexOf("DO $confere$"));
    expect(sql.slice(k).trim()).toBe("COMMIT;");
  });

  it("ACL pelo nome, copiando a viva: parceiro_precos só service_role; simular níveis authenticated e service_role", () => {
    expect(codigo).toContain(
      "REVOKE ALL ON FUNCTION public.parceiro_precos(uuid) FROM PUBLIC, anon, authenticated;",
    );
    expect(codigo).toContain(
      "GRANT EXECUTE ON FUNCTION public.parceiro_precos(uuid) TO service_role;",
    );
    expect(codigo).toContain(
      "REVOKE ALL ON FUNCTION public.parceiro_simular_niveis(jsonb) FROM PUBLIC, anon;",
    );
    expect(codigo).toContain(
      "GRANT EXECUTE ON FUNCTION public.parceiro_simular_niveis(jsonb) TO authenticated, service_role;",
    );
    expect([...codigo.matchAll(/\bGRANT\b/g)]).toHaveLength(2);
    expect([...codigo.matchAll(/\bREVOKE\b/g)]).toHaveLength(2);
  });
});

describe("parceiro até o balcão: troca na definição viva, com os md5 provados", () => {
  it("os corpos guardados são os vivos de 15/11/2026 e a migração os confere pelo md5", () => {
    expect(md5(precosVivo)).toBe(MD5_PRECOS_ANTIGO);
    expect(md5(simularVivo)).toBe(MD5_SIMULAR_ANTIGO);
    expect(sql).toContain(`v_md5_precos_lido constant text := '${MD5_PRECOS_ANTIGO}'`);
    expect(sql).toContain(`v_md5_sim_lido constant text := '${MD5_SIMULAR_ANTIGO}'`);
  });

  it("refazer a troca sobre os corpos vivos dá exatamente os md5 do ensaio", () => {
    expect(md5(precosNovo)).toBe(MD5_PRECOS_NOVO);
    expect(md5(simularNovo)).toBe(MD5_SIMULAR_NOVO);
    expect(sql).toContain(`v_md5_precos_novo constant text := '${MD5_PRECOS_NOVO}'`);
    expect(sql).toContain(`v_md5_sim_novo constant text := '${MD5_SIMULAR_NOVO}'`);
    expect(sql).toContain(`<> '${MD5_PRECOS_NOVO}'`);
    expect(sql).toContain(`<> '${MD5_SIMULAR_NOVO}'`);
  });

  it("cada trecho aparece o número de vezes que a migração exige, e ela confere isso", () => {
    expect(vezes(precosVivo, sVelho)).toBe(3);
    expect(vezes(precosVivo, fVelho)).toBe(2);
    expect(vezes(simularVivo, mVelho)).toBe(1);
    expect(sql).toContain("IF v_n <> 3 THEN");
    expect(sql).toContain("IF v_n <> 2 THEN");
    expect(sql).toContain("IF v_n <> 1 THEN");
  });

  it("para sem trocar se o corpo vivo for outro, e não faz nada se já estiver trocado", () => {
    expect(sql).toContain("IF v_md5 <> v_md5_precos_lido THEN");
    expect(sql).toContain("IF v_md5 <> v_md5_sim_lido THEN");
    expect(sql).toContain("IF v_md5 = v_md5_precos_novo THEN");
    expect(sql).toContain("IF v_md5 = v_md5_sim_novo THEN");
    expect(sql).toContain("mudou desde 15/11/2026");
  });

  it("o teto é o preço base (ou a referência da faixa) e nenhum GREATEST do piso ficou sem LEAST por fora", () => {
    expect(sNovo).toBe(`LEAST(${sVelho}, NULLIF(b.preco_base, 0))`);
    expect(fNovo).toBe(`LEAST(${fVelho}, NULLIF(round(f.preco_unitario, 4), 0))`);
    expect(mNovo).toBe("LEAST(GREATEST(c.com_desconto, c.piso), NULLIF(c.preco, 0)) AS pago");
    // a referência que a função devolve é a mesma do teto
    expect(precosNovo).toContain("'preco_referencia', round(f.preco_unitario, 4)");
    expect(precosNovo).toContain("CASE WHEN fx.lista IS NULL THEN b.preco_base END");
    const pisos = [...precosNovo.matchAll(/GREATEST\(round\(/g)];
    expect(pisos).toHaveLength(5);
    for (const m of pisos) expect(precosNovo.slice(m.index! - 6, m.index!)).toBe("LEAST(");
    expect(simularNovo).not.toMatch(/[^T]\(?GREATEST\(c\.com_desconto, c\.piso\)\s+AS pago/);
  });

  it("o resto do corpo ficou igual: só os trechos trocados mudaram", () => {
    expect(precosNovo.split(sNovo).join(sVelho).split(fNovo).join(fVelho)).toBe(precosVivo);
    expect(simularNovo.split(mNovo).join(mVelho)).toBe(simularVivo);
  });

  it("a origem piso e a regra do piso ficam como estavam", () => {
    const origem =
      "WHEN b.piso IS NOT NULL AND b.piso > round(b.preco_base * (1 - v_desc / 100), 2) THEN 'piso'";
    expect(precosVivo).toContain(origem);
    expect(precosNovo).toContain(origem);
    expect(precosNovo).toContain(
      "round(p.custo_medio / (1 - COALESCE(p.margem_minima, 0) / 100), 2) END AS piso",
    );
    expect(precosNovo).toContain("'faixa'");
    expect(precosNovo).toContain("'tabela'");
    expect(precosNovo).toContain("'oferta'");
    expect(precosNovo).toContain("'nivel'");
  });
});

describe("parceiro até o balcão: a conferência final da migração", () => {
  const confere = sql.slice(sql.indexOf("DO $confere$"));

  it("confere versão única, md5, ACL, search_path e modo de segurança", () => {
    expect(confere).toContain("esperava uma versão de cada função");
    expect(confere).toContain("o corpo novo de parceiro_precos não tem o md5 do ensaio");
    expect(confere).toContain("o corpo novo de parceiro_simular_niveis não tem o md5 do ensaio");
    expect(confere).toContain("a ACL de parceiro_precos mudou");
    expect(confere).toContain("a ACL de parceiro_simular_niveis mudou");
    expect(confere).toContain("'search_path=public' = ANY (proconfig)");
  });

  it("varre todos os parceiros ativos, preço simples e faixas, e desfaz tudo se algum passar do balcão", () => {
    expect(confere).toContain("FROM public.parceiros p WHERE p.status::text = 'ativo'");
    expect(confere).toContain("x.faixas IS NULL AND x.preco_parceiro > x.preco_referencia");
    expect(confere).toContain(
      "(f->>'preco_parceiro')::numeric > (f->>'preco_referencia')::numeric",
    );
    expect(confere).toContain("preço(s) de parceiro acima do balcão depois da troca");
  });
});

describe("parceiro até o balcão: o roteiro de ensaio", () => {
  const blocosSql = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
  const ensaio = blocosSql.find((b) => b.includes("ENSAIO OK"))!;
  const volta = blocosSql.find((b) => b.includes("DO $volta$"))!;

  it("traz os md5 e os mesmos trechos da migração", () => {
    for (const h of [MD5_PRECOS_ANTIGO, MD5_PRECOS_NOVO, MD5_SIMULAR_ANTIGO, MD5_SIMULAR_NOVO])
      expect(doc).toContain(h);
    for (const t of [sVelho, sNovo, fVelho, fNovo, mVelho, mNovo]) {
      expect(ensaio).toContain(t);
      expect(volta).toContain(t);
    }
    expect(ensaio).toContain(`v_md5_precos_novo constant text := '${MD5_PRECOS_NOVO}'`);
  });

  it("o ensaio desfaz tudo: termina em RAISE EXCEPTION e não tem COMMIT nem BEGIN", () => {
    const sem = semComentarios(ensaio);
    expect(sem).not.toMatch(/\bCOMMIT\s*;/i);
    expect(sem).not.toMatch(/^\s*BEGIN;/im);
    expect(ensaio.trimEnd().endsWith("END $relatorio$;")).toBe(true);
    expect(ensaio).toContain("RAISE EXCEPTION E'ENSAIO OK (desfeito de propósito)");
    expect(comandosSemWhere(sem)).toEqual([]);
  });

  it("prova antes e depois nos 4 níveis, a diferença que não é correção e a ACL", () => {
    expect(ensaio).toContain("FROM public.parceiro_niveis ORDER BY ordem");
    expect(ensaio).toContain("SET nivel_fixo_id = v_n.id WHERE id = v_parc");
    expect(ensaio).toContain("ENSAIO FALHOU: antes não havia produto acima do balcão");
    expect(ensaio).toContain("ENSAIO FALHOU: depois ainda há produto acima do balcão");
    expect(ensaio).toContain("ENSAIO FALHOU: houve diferença que não é correção");
    expect(ensaio).toContain("public.parceiro_simular_niveis(NULL)");
    expect(ensaio).toContain("p.proacl::text");
  });

  it("registra o resultado provado no banco vivo e que foi aplicada", () => {
    expect(doc).toContain("**0 que não são correção**");
    expect(doc).toContain("0 linhas acima do balcão em qualquer nível");
    expect(doc).toContain("**Estado: aplicada em 15/11/2026.**");
    expect(doc).toContain("20261115170000_parceiro_nunca_paga_mais_que_o_balcao.sql");
  });

  it("a auditoria de origem vai junto no repositório", () => {
    expect(
      readFileSync(join(RAIZ, "docs", "auditoria-orcamentos-precos-margem-15-11.md"), "utf8"),
    ).toContain("parceiro_precos");
  });
});

describe("parceiro até o balcão: os consumidores não dependem de `piso` pagar mais que o balcão", () => {
  function arquivos(pasta: string): string[] {
    return readdirSync(pasta).flatMap((n) => {
      const p = join(pasta, n);
      return statSync(p).isDirectory() ? arquivos(p) : [p];
    });
  }
  const fontes = arquivos(join(RAIZ, "src")).filter(
    (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(join("integrations", "supabase", "types.ts")),
  );

  it("nenhum código compara a origem do preço do parceiro com 'piso'; só 'nivel' é distinguido", () => {
    for (const p of fontes) {
      expect(readFileSync(p, "utf8"), p).not.toMatch(/origem\w*\s*[!=]==?\s*["']piso["']/);
    }
    const usam = fontes.filter((p) =>
      /parceiro\??\.origem\s*===\s*"nivel"/.test(readFileSync(p, "utf8")),
    );
    expect(usam.length).toBeGreaterThan(0);
  });
});
