import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIAS_CUSTO_OS } from "../src/domain/custos/categorias";

/**
 * ESTORNO DE BAIXA TIRA DA OS O CUSTO QUE A BAIXA LANÇOU.
 *
 * `baixar_estoque_os` tira o material do lote e lança o custo na OS
 * (custos_operacionais_os, 'material' / 'baixa_estoque'). Até a migração
 * 20261008100000, `estornar_baixa_estoque_os` devolvia o material ao lote e
 * deixava o custo onde estava: medido na OS 49 em 08/10/2026, depois do estorno
 * a OS seguia com R$ 32,46 de lona que voltou para a prateleira, e lucro e
 * margem realizados errados. O mesmo estorno trocava o "último custo" do
 * material (gatilho do custo médio contava a volta como compra) e aceitava
 * estornar saída sem lote, respondendo "feito" sem devolver nada.
 *
 * O comportamento foi provado no banco (Yvens e Harison, claims + SET LOCAL
 * ROLE, antes e depois, tudo desfeito). Este teste segura o que o repositório
 * pode vir a mudar: uma migração nova que redefina o estorno sem o custo, a
 * baixa mudar de categoria ou de preço sem o estorno acompanhar, ou o gatilho
 * do custo médio voltar a contar estorno como compra.
 */

const RAIZ = join(__dirname, "..");
const PASTA_MIGRACOES = join(RAIZ, "supabase/migrations");
const ESTA = "20261008100000_estorno_de_baixa_tira_o_custo.sql";

/** SQL sem comentários de linha: o cabeçalho explica a regra antiga e não conta. */
function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

const migracoes = readdirSync(PASTA_MIGRACOES)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ arquivo: f, codigo: semComentarios(readFileSync(join(PASTA_MIGRACOES, f), "utf8")) }));

/**
 * Corpo da ÚLTIMA definição textual de uma função nas migrações: é a que vale
 * depois de rodar todas, na ordem. (A baixa ainda leva um remendo de mensagem
 * por substituição de texto em 20260925000000, que não mexe no custo.)
 */
function ultimaDefinicao(nome: string): { arquivo: string; corpo: string } {
  const re = new RegExp(
    String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?${nome}\s*\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\1\$`,
    "gi",
  );
  let achada: { arquivo: string; corpo: string } | undefined;
  for (const { arquivo, codigo } of migracoes) {
    for (const m of codigo.matchAll(re)) achada = { arquivo, corpo: m[2] };
  }
  if (!achada) throw new Error(`nenhuma migração define ${nome}`);
  return achada;
}

/** Os VALUES de cada `INSERT INTO <tabela>` do corpo, um por insert. */
function valoresDoInsert(corpo: string, tabela: string): string[] {
  const re = new RegExp(
    String.raw`insert\s+into\s+(?:public\.)?${tabela}\s*\([^)]*\)\s*values\s*\(([\s\S]*?)\)\s*(?:returning\b[^;]*)?;`,
    "gi",
  );
  return [...corpo.matchAll(re)].map((m) => m[1].replace(/\s+/g, " ").trim());
}

/** Os textos entre aspas simples, na ordem em que aparecem. */
function literais(valores: string): string[] {
  return [...valores.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

const estorno = ultimaDefinicao("estornar_baixa_estoque_os");
const baixa = ultimaDefinicao("baixar_estoque_os");
const custoMedio = ultimaDefinicao("tg_material_custo_medio");

describe("estorno de baixa tira o custo da OS", () => {
  it("a definição que vale do estorno é a desta migração (ou uma mais nova que a mantenha)", () => {
    expect(estorno.arquivo >= ESTA, `última definição em ${estorno.arquivo}`).toBe(true);
  });

  it("lança um custo negativo de material, no mesmo item e tarefa da baixa", () => {
    const [custo, ...outros] = valoresDoInsert(estorno.corpo, "custos_operacionais_os");
    expect(custo, "o estorno precisa lançar custo na OS").toBeDefined();
    expect(outros).toEqual([]);
    expect(literais(custo)).toEqual(["material", "estorno_baixa"]);
    expect(custo).toMatch(/^m\.os_id, m\.os_item_id, m\.tarefa_id,/);
    // Quantidade negativa × o preço que a baixa gravou na movimentação.
    expect(custo).toContain("-m.quantidade");
    expect(custo).toMatch(/m\.custo_unitario_snapshot/);
  });

  it("não apaga nem altera a linha da baixa: o rastro fica", () => {
    expect(estorno.corpo).not.toMatch(/delete\s+from\s+(?:public\.)?custos_operacionais_os/i);
    expect(estorno.corpo).not.toMatch(/update\s+(?:public\.)?custos_operacionais_os/i);
  });

  it("espelha a baixa: mesma categoria, e a baixa grava o mesmo preço na movimentação e no custo", () => {
    const [custoDaBaixa] = valoresDoInsert(baixa.corpo, "custos_operacionais_os");
    const [movDaBaixa] = valoresDoInsert(baixa.corpo, "movimentacoes_estoque");
    const [custoDoEstorno] = valoresDoInsert(estorno.corpo, "custos_operacionais_os");
    expect(custoDaBaixa, `baixa em ${baixa.arquivo}`).toBeDefined();

    // Categoria: se a baixa mudar, o estorno tem de mudar junto, senão a soma
    // por categoria (custo_real_por_peca, painel por categoria) fica torta.
    expect(literais(custoDoEstorno)[0]).toBe(literais(custoDaBaixa)[0]);
    expect(CATEGORIAS_CUSTO_OS as readonly string[]).toContain(literais(custoDoEstorno)[0]);

    // O estorno pega o preço da MOVIMENTAÇÃO; ele só zera o custo porque a
    // baixa grava o mesmo preço do lote nos dois lugares.
    expect(movDaBaixa).toMatch(/l\.custo_unitario_snapshot/);
    expect(custoDaBaixa).toMatch(/l\.custo_unitario_snapshot/);

    // E a saída da baixa tem a origem que o estorno aceita.
    expect(literais(movDaBaixa)).toContain("baixa_os");
  });

  it("só estorna baixa de OS e recusa quando o lote não existe, em vez de dizer 'feito'", () => {
    expect(estorno.corpo).toMatch(/IF m\.origem IS DISTINCT FROM 'baixa_os' THEN\s+RAISE EXCEPTION/);
    expect(estorno.corpo).toMatch(
      /UPDATE public\.material_lotes SET quantidade = quantidade \+ m\.quantidade WHERE id = m\.lote_id;\s+IF NOT FOUND THEN\s+RAISE EXCEPTION/,
    );
  });

  it("o custo médio não conta estorno como compra, nem no disparo nem na média", () => {
    expect(custoMedio.arquivo >= ESTA, `última definição em ${custoMedio.arquivo}`).toBe(true);
    const [disparo, media] = custoMedio.corpo.split(/SELECT CASE WHEN SUM\(quantidade\)/);
    expect(media, "o cálculo da média mudou de forma; reveja este teste").toBeDefined();
    expect(disparo).toMatch(/COALESCE\(NEW\.origem, ''\) = 'estorno_os' THEN\s+RETURN NULL;/);
    expect(media).toMatch(/AND COALESCE\(origem, ''\) <> 'estorno_os'/);
  });
});

describe("quem executa o estorno", () => {
  const codigoDesta = migracoes.find((m) => m.arquivo === ESTA)!.codigo;

  it("tira de PUBLIC, anon e authenticated e devolve só a authenticated (a guarda lê auth.uid())", () => {
    // REVOKE de PUBLIC sozinho não fecha: no Supabase anon e authenticated
    // têm grant próprio.
    expect(codigoDesta).toContain(
      "REVOKE ALL ON FUNCTION public.estornar_baixa_estoque_os(uuid, text) FROM PUBLIC, anon, authenticated;",
    );
    expect(codigoDesta).toContain(
      "GRANT EXECUTE ON FUNCTION public.estornar_baixa_estoque_os(uuid, text) TO authenticated, service_role;",
    );
    expect(codigoDesta).toContain(
      "REVOKE ALL ON FUNCTION public.tg_material_custo_medio() FROM PUBLIC, anon, authenticated;",
    );
  });

  it("nenhuma migração dá o estorno ou o gatilho do custo médio a anon ou PUBLIC", () => {
    const culpados = migracoes
      .flatMap(({ arquivo, codigo }) =>
        [...codigo.matchAll(/GRANT\s+[^;]*?\bON\s+FUNCTION\s+(?:public\.)?(estornar_baixa_estoque_os|tg_material_custo_medio)\b[^;]*?\bTO\s+([^;]+);/gi)]
          .filter((m) => /\b(anon|public)\b/i.test(m[2]))
          .map((m) => `${arquivo}: ${m[1]} TO ${m[2].trim()}`),
      );
    expect(culpados).toEqual([]);
  });
});
