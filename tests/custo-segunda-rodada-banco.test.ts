import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Segunda rodada da revisão adversarial do PR 425 (04/11/2026), a parte do banco e da fiação das telas.
 *
 * O comportamento das funções foi ensaiado no banco vivo, em transação desfeita, antes e depois da troca
 * (alçada com custo parcial nos casos folga, aperto e sem custo parcial; resposta de 62 orçamentos
 * igual antes e depois, para vendedor e financeiro; Repassar com e sem mudança de custo de material):
 * aqui o teste confere o TEXTO da migração, para que quem trocar a regra seja avisado. O que roda em
 * código puro (cópia de item, preço por m², leitura das fórmulas, aviso do preço) tem teste de
 * comportamento em tests/copia-de-item-por-area.test.ts.
 */

const migracao = readFileSync("supabase/migrations/20261104300000_custo_segunda_rodada.sql", "utf8");
const tela = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
const preco = readFileSync("src/components/orcamento/preco-do-orcamento.tsx", "utf8");
const blocoDoItem = readFileSync("src/components/orcamento/material-por-formula.tsx", "utf8");
const custoDaPeca = readFileSync("src/components/produtos/custo-da-peca.tsx", "utf8");

describe("alçada do desconto com custo parcial", () => {
  it("o que já se sabe do custo de uma linha sem custo-base vira piso certo, sem tirar a linha do limite fixo", () => {
    expect(migracao).toContain("pg_get_functiondef('public.desconto_avaliar(uuid,numeric,numeric,numeric)'::regprocedure)");
    expect(migracao).toContain("v_parcial := v_parcial + v_f;");
    // A linha continua contada como sem custo: a regra segue sendo o limite fixo de 10%.
    expect(migracao).toContain("v_sem_custo := v_sem_custo + 1;");
    expect(migracao).toContain("OR (v_parcial > 0 AND v_total < round((v_custo + v_parcial) / (1 - v_taxa), 2)) THEN");
  });

  it("o teto de quem vende nunca passa do que mantém o total acima do custo conhecido", () => {
    expect(migracao).toContain("v_max_vendedor := LEAST(v_max_vendedor,");
    expect(migracao).toContain("GREATEST(round(v_sub - v_cred - round((v_custo + v_parcial) / (1 - v_taxa), 2), 2), 0));");
    expect(migracao).toContain("'piso_parcial', v_parcial > 0");
  });

  it("quem não vê o financeiro não recebe o teto calculado nem a marca de piso parcial", () => {
    expect(migracao).toContain("pg_get_functiondef('public.desconto_do_orcamento(uuid,text,numeric)'::regprocedure)");
    expect(migracao).toContain("v_parcial := COALESCE((v_s->>'piso_parcial')::boolean, false);");
    expect(migracao).toContain("- 'taxa' - 'piso_parcial';");
    expect(migracao).toContain("IF v_s->>'regra' = 'margem' OR v_parcial THEN");
  });

  it("a mensagem de bloqueio deixa de dizer só 'acima de 10%' quando o motivo é o custo cadastrado", () => {
    expect(migracao).toContain("pg_get_functiondef('public.tg_parceiro_credito_no_total()'::regprocedure)");
    expect(migracao).toContain("Desconto acima de 10%% (ou que deixa o total abaixo do custo já cadastrado) com item sem custo completo passa da sua alçada.");
  });
});

describe("Repassar só repassa a diferença", () => {
  it("troca a função depois de conferir que é a que foi lida, e soma a diferença ao custo previsto", () => {
    expect(migracao).toContain("md5(v_def) <> '4a9da77c41553c7acfd2876d60600509'");
    expect(migracao).toContain("p.quantidade * (coalesce(m.custo_unitario, 0) - coalesce(p.custo_unitario_previsto, 0)) as delta");
    expect(migracao).toContain("returning p.os_id, a.delta");
    expect(migracao).toContain("set custo_previsto = greatest(coalesce(o.custo_previsto, 0) + d.delta, d.soma_nova, 0)");
  });

  it("não regrava mais o custo previsto com a soma dos materiais", () => {
    expect(migracao).not.toMatch(/set custo_previsto = sub\.total/);
    expect(migracao).not.toContain("coalesce(o.custo_previsto,0) is distinct from sub.total");
  });

  it("continua exigindo custos.update e deixando de fora linha com reserva ou movimentação", () => {
    expect(migracao).toContain("v_uid := public.require_permission('custos.update');");
    expect(migracao).toContain("from public.estoque_reservas r");
    expect(migracao).toContain("from public.movimentacoes_estoque mv");
    expect(migracao).toContain("o.status::text not in ('concluido','faturado','cancelado')");
  });
});

describe("cada troca é feita sobre a definição viva e para em voz alta se ela mudou", () => {
  it("âncoras com contagem, e rodar de novo não faz nada", () => {
    expect(migracao.match(/RAISE EXCEPTION '[a-z_]+: /g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(migracao.match(/RAISE NOTICE '[^']*já /g)?.length ?? 0).toBe(4);
    expect(migracao.split("DO $m$").length - 1).toBe(4);
  });

  it("o prefixo da migração é único entre todas as do repositório", () => {
    const prefixos = readdirSync("supabase/migrations").map((f) => f.slice(0, 14));
    expect(prefixos.filter((p) => p === "20261104300000")).toHaveLength(1);
  });
});

describe("a tela", () => {
  it("o Salvar do item só grava as fórmulas depois de lidas, e a leitura pendente ou falha trava com aviso", () => {
    expect(tela).toContain('formulasDoItem.isSuccess ? "ok" : formulasDoItem.isError ? "erro" : "pendente"');
    expect(tela).toContain("if (!formulas.gravar) return toast.error(formulas.pendencia);");
    expect(tela).toContain("materiais_por_formula: formulas.valor,");
    expect(tela).not.toContain("materiais_por_formula: calculoDasFormulas.validas,");
  });

  it("Duplicar e Repetir último pedido copiam pela função pura e param quando a leitura não devolve todos os itens", () => {
    expect(tela).toContain("copiaDoItem(item, {");
    expect(tela).toContain("copiaDaCobranca(l, {");
    expect(tela).toContain("return toast.error(AVISO_FORMULAS_FALTANDO);");
    // O preço do catálogo não entra mais na cópia da cobrança: o preço especial do cliente sobrevive.
    expect(tela).not.toContain("catalogo.produtos.find((p) => p.id === l.produto_id)?.preco_base ?? null");
  });

  it("o aviso do preço não promete 'preço de tabela' e há como refazer o preço em cliente final, com confirmação", () => {
    expect(preco).toContain("textoDoPrecoAplicado(novo, r)");
    expect(preco).not.toContain("Voltou ao preço de tabela");
    expect(preco).toContain('data-testid="refazer-precos"');
    expect(preco).toContain("Preço digitado à mão nesses itens é substituído.");
    expect(preco).toContain('data-testid="confirmar-refazer-precos"');
  });

  it("terceirizado por m² em item sem medida avisa nas duas telas, com texto legível (12 px, contraste alto)", () => {
    for (const fonte of [blocoDoItem, custoDaPeca]) {
      expect(fonte).toContain('data-testid="terceirizado-sem-medida"');
      // amber-700 em cima do cinza claro do cartão dava 4,49:1 (medido no navegador); amber-800 dá 6,3:1.
      expect(fonte).toContain("text-xs font-medium text-amber-800 dark:text-amber-400");
      expect(fonte).not.toContain("text-amber-700");
      expect(fonte).toContain("t.semMedida");
    }
  });
});
