import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Versão congelada do orçamento (22/10/2026, R1 do plano). Havia 0 versões para
 * 26 orçamentos enviados ou aprovados. Aplicado com ensaio: reenvio igual não
 * duplica; mudar e reaprovar gera a versão 2 (R$ 660) como aprovada; mexer
 * depois mostra "mudou" (R$ 660 × R$ 880); o retrato não leva custo nem token do
 * link; a conversão recusa quando o valor não é o aprovado.
 */

const SQL = readFileSync("supabase/migrations/20261022210000_orcamento_versao_congelada.sql", "utf8");
const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

describe("o banco congela, por qualquer porta", () => {
  it("gatilho BEFORE UPDATE OF status, só quando o status VIRA enviado ou aprovado, e por último", () => {
    expect(SQL).toContain("CREATE TRIGGER zz_orcamento_congela_versao");
    expect(SQL).toContain("BEFORE UPDATE OF status ON public.orcamentos");
    expect(SQL).toContain("WHEN (NEW.status::text IN ('enviado', 'aprovado') AND OLD.status IS DISTINCT FROM NEW.status)");
  });

  it("conteúdo igual à última versão reaproveita; conteúdo novo gera a próxima", () => {
    expect(SQL).toContain("v_ultima.snapshot->>'hash' = v_hash");
    expect(SQL).toContain("coalesce(v_ultima.numero_versao, 0) + 1");
  });

  it("a aprovada vira versao_aprovada_id", () => {
    expect(SQL).toContain("IF v_aprovando THEN NEW.versao_aprovada_id := v_id; END IF;");
  });

  it("o retrato não leva custo, margem, parâmetros nem token do link", () => {
    expect(SQL).toContain("- 'custo_unitario' - 'custo_previsto' - 'margem_prevista' - 'parametros' - 'produto_snapshot'");
    expect(SQL).toContain("- 'custo_estimado' - 'margem_estimada' - 'token_publico' - 'aprovado_ip'");
  });

  it("as funções auxiliares não ficam abertas ao navegador; só a diferença, a quem vê preço", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.orcamento_itens_para_versao(uuid) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.orcamento_hash_atual(uuid) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("NOT public.can_see_prices(v_uid)");
  });
});

describe("a conversão e os antigos", () => {
  it("converter recusa quando o valor de hoje não é o aprovado, com os dois valores", () => {
    expect(SQL).toContain("O orçamento mudou depois de aprovado: o cliente aprovou R$ % e hoje está R$ %");
    expect(SQL).toContain("IF n <> 1 THEN");
  });

  it("os que já estavam enviados, aprovados ou convertidos ganham a versão 1, marcada retroativa", () => {
    expect(SQL).toContain("status::text IN ('enviado', 'aprovado', 'convertido')");
    expect(SQL).toContain("'retroativa', true");
    expect(SQL).not.toMatch(/\bDELETE\b/i);
  });
});

describe("a tela avisa", () => {
  it("lê a diferença pelo banco e mostra o que a versão tinha e o que está hoje", () => {
    expect(TELA).toContain('"orcamento_diferenca_da_versao"');
    expect(TELA).toContain("Mudou depois de");
    expect(TELA).toContain("brlVersao(versao.valor_da_versao)");
  });

  it("diz o que fazer: aprovado → voltar o valor ou aprovar de novo; enviado → enviar de novo", () => {
    expect(TELA).toContain("Para converter em OS o valor precisa voltar ao aprovado, ou o cliente aprovar de novo.");
    expect(TELA).toContain("Envie de novo para registrar a nova versão.");
  });
});
