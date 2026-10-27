import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (caminho: string) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

const migracao = ler("supabase/migrations/20261027400000_auditoria_dos_dashboards.sql");
const painel = ler("src/routes/_authenticated/dashboard.tsx");
const metaDoMes = ler("src/components/painel/MetaDoMes.tsx");
const metasDaEquipe = ler("src/components/painel/MetasDaEquipe.tsx");
const pendencias = ler("src/components/painel/PendenciasDoMeuPapel.tsx");
const folha = ler("src/components/estoque/folha-de-contagem.tsx");

describe("auditoria dos dashboards (27/10/2026)", () => {
  it("o ponto de equilíbrio conta o dia no relógio de Macapá, não no UTC do banco", () => {
    // Depois das 21h de Macapá o banco já está no dia seguinte: "26 de 31 dias" no dia 26.
    const funcao = migracao.slice(migracao.indexOf("CREATE OR REPLACE FUNCTION public.ponto_de_equilibrio"), migracao.indexOf("DO $migracao$"));
    expect(funcao).toContain("America/Belem");
    expect(funcao).not.toMatch(/CURRENT_DATE/);
    expect(funcao).toContain("'hoje', v_hoje");
  });

  it("OS de uso interno sem material não entra em 'concluídas sem baixa de material'", () => {
    expect(migracao).toMatch(/os\.finalidade::text = 'venda' OR EXISTS \(SELECT 1 FROM public\.os_materiais_previstos/);
    // E o aviso para se o trecho da regra mudar, em vez de aplicar em silêncio uma regra velha.
    expect(migracao).toContain("não foi encontrado");
  });

  it("as views oficiais contam só OS de venda e o ticket é o do que foi aprovado", () => {
    expect(migracao).toMatch(/finalidade::text = 'venda' AND status::text <> 'cancelado'/);
    // As views são invoker e estas colunas não têm GRANT: ler a tabela direto dá 403 e o cartão sai "—".
    expect(migracao).toContain("public.orcamentos_financeiro");
    expect(migracao.slice(migracao.indexOf("-- 4) vw_dashboard_comercial: ticket"))).not.toMatch(/FROM public\.orcamentos o\s+WHERE o\.status/);
    expect(migracao).toMatch(/ticket_medio/);
    expect(migracao).toMatch(/IN \('aprovado', 'convertido'\)/);
    // CREATE OR REPLACE VIEW descarta security_invoker: tem de ser reposto nas duas.
    expect(migracao.match(/SET \(security_invoker = true\)/g)?.length).toBe(2);
  });

  it("o painel mostra a meta de cada vendedor, separada do ponto de equilíbrio", () => {
    expect(painel).toContain("<MetasDaEquipe />");
    expect(metasDaEquipe).toContain('"meta_painel"');
    expect(metasDaEquipe).toContain("<BarraDeMeta");
    // O nível é do PAGO; o bloco diz isso em vez de prometer comissão sobre o vendido.
    expect(metasDaEquipe).toMatch(/contam só o que o cliente já pagou/);
  });

  it("o ritmo do mês diz a data de hoje e quanto falta por dia", () => {
    expect(metaDoMes).toContain("hojeCurto");
    expect(metaDoMes).toMatch(/por dia nos \$\{diasRestantes\} dias que restam/);
  });

  it("a lista de estoque crítico é a mesma conta do cartão (zerados + no mínimo com saldo)", () => {
    expect(painel).toContain("materiaisCriticos");
    expect(painel).not.toMatch(/materiais\s*\.filter\(\(m: any\) => Number\(m\.estoque \?\? 0\) <= 0\)\s*\.map/);
  });

  it("'nunca receberam entrada' abre a folha de contagem num pop-up e relê o painel ao aplicar", () => {
    expect(pendencias).toContain("estoque_nunca_carregado");
    expect(pendencias).toContain("<ContagemRapidaDoPainel");
    expect(folha).toContain("aberta?: boolean");
    expect(folha).toContain('queryKey: ["pendencias-do-sistema"]');
    expect(migracao).toContain("'/movimentacoes'");
  });
});
