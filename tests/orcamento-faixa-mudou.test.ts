import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Faixa "Mudou depois de enviado/aprovado" (decisão 7, 05/11/2026): 38 de 44 orçamentos com versão acusavam
 * mudança sem ter mudado, porque o hash do retrato conta toda coluna nova de orcamento_itens. A RPC passa a
 * comparar SÓ as chaves que o retrato guardou. Só leitura: o que a versão guarda não muda.
 */

const SQL = readFileSync("supabase/migrations/20261110190000_faixa_mudou_so_pelo_que_a_versao_guardou.sql", "utf8");
const CODIGO = SQL.replace(/--[^\n]*/g, ""); // sem comentários
const ORIGINAL = readFileSync("supabase/migrations/20261022210000_orcamento_versao_congelada.sql", "utf8");
const COMPARACAO = CODIGO.slice(
  CODIGO.indexOf("CREATE OR REPLACE FUNCTION public.orcamento_retrato_diferencas"),
  CODIGO.indexOf("REVOKE ALL ON FUNCTION public.orcamento_retrato_diferencas"),
);

describe("a comparação parte do que o retrato guardou", () => {
  it("percorre as chaves do retrato, ignora a que sumiu hoje e compara em jsonb (número por valor)", () => {
    expect(COMPARACAO).toContain("jsonb_each(gi.item)");
    expect(COMPARACAO).toContain("AND vi.item ? kv.key");
    expect(COMPARACAO).toContain("AND kv.value IS DISTINCT FROM (vi.item -> kv.key)");
  });

  it("não compara por hash nem por texto", () => {
    expect(COMPARACAO).not.toMatch(/md5\s*\(/i);
    expect(COMPARACAO).not.toMatch(/::text\s*(=|<>)/);
  });

  it("deixa de fora a identidade e a arte, e só isso", () => {
    expect(COMPARACAO).toContain("kv.key <> ALL (ARRAY['id', 'orcamento_id', 'created_at', 'arquivo_id'])");
  });

  it("item novo, item tirado e item mudado acusam; retrato sem itens e com total positivo só compara o total", () => {
    expect(COMPARACAO).toContain("'mudou', EXISTS (SELECT 1 FROM tirados) OR EXISTS (SELECT 1 FROM novos) OR EXISTS (SELECT 1 FROM mudados)");
    expect(COMPARACAO).toContain("AS sem_itens");
    expect(COMPARACAO.match(/NOT cego\.sem_itens/g)).toHaveLength(2);
  });
});

describe("os termos do cabeçalho", () => {
  const listas = [...COMPARACAO.matchAll(/unnest\(ARRAY\[([^\]]+)\]\)/g)].map((m) => m[1]).join(",");

  it("são só o que o cliente vê", () => {
    for (const termo of ["cliente_id", "validade_dias", "prazo", "data_entrega_prometida", "titulo", "observacao_cliente", "forma", "parcelas"]) {
      expect(listas).toContain(`'${termo}'`);
    }
  });

  it("nunca incluem o que o próprio fluxo grava depois do envio", () => {
    for (const fluxo of [
      "status", "updated_at", "os_id", "versao_aprovada_id", "visualizacoes", "visualizado_em", "aprovado_em", "enviado_em",
      "observacoes", "observacao_interna", "vendedor_id", "pix_enviado", "pix_recebido", "etapa_comercial",
    ]) {
      expect(listas, `${fluxo} não pode ser termo`).not.toContain(`'${fluxo}'`);
    }
  });

  it("vazio que vira valor não conta; valor que troca conta", () => {
    expect(COMPARACAO).toContain("AND x.antes IS DISTINCT FROM x.depois");
    expect(COMPARACAO).toContain("x.antes IN ('null'::jsonb, '\"\"'::jsonb, '{}'::jsonb, '[]'::jsonb)");
  });
});

describe("a RPC", () => {
  it("troca a conta do hash pela comparação, com âncora contada que para se a função mudou", () => {
    expect(CODIGO).toContain("pg_get_functiondef('public.orcamento_diferenca_da_versao(uuid)'::regprocedure)");
    expect(CODIGO).toContain("RAISE EXCEPTION 'orcamento_diferenca_da_versao: âncora % apareceu % vezes (esperado 1)', k, n;");
    expect(CODIGO).toContain("public.orcamento_retrato_diferencas(v_ultima.snapshot");
  });

  it("o total sempre acusa, e a falta de resposta da comparação também", () => {
    expect(CODIGO).toContain("'mudou', (v_ultima.valor_total IS DISTINCT FROM v_atual) OR coalesce((v_dif->>'mudou')::boolean, true),");
  });

  it("rodar de novo é inofensivo", () => {
    expect(CODIGO).toContain("IF position('orcamento_retrato_diferencas' IN v_def) > 0 THEN");
  });

  it("o helper fica fechado ao navegador e a RPC só a quem está logado", () => {
    expect(CODIGO).toContain("REVOKE ALL ON FUNCTION public.orcamento_retrato_diferencas(jsonb, jsonb) FROM PUBLIC, anon, authenticated;");
    expect(CODIGO).toContain("REVOKE ALL ON FUNCTION public.orcamento_diferenca_da_versao(uuid) FROM PUBLIC, anon;");
    expect(CODIGO).toContain("GRANT EXECUTE ON FUNCTION public.orcamento_diferenca_da_versao(uuid) TO authenticated;");
  });
});

describe("só leitura: não mexe no que a versão guarda", () => {
  it("não escreve em tabela e não recria o gatilho, o hash nem o retrato dos itens", () => {
    expect(CODIGO).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i);
    expect(CODIGO).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(tg_orcamento_congela_versao|orcamento_hash_atual|orcamento_itens_para_versao)/);
  });

  it("a conversão em OS continua sem ler o hash, só o valor aprovado", () => {
    const bloco = ORIGINAL.slice(ORIGINAL.indexOf("-- 4. A conversão recusa"), ORIGINAL.indexOf("-- 5. Os que já estavam"));
    expect(bloco).not.toMatch(/hash/i);
    expect(bloco).toContain("SELECT v.valor_total INTO v_aprov");
  });
});
