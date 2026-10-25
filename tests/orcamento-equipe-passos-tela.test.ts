import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A tela do orçamento da equipe nos quatro passos (25/10/2026): mesma barra do
 * parceiro, e cada coisa que já existia no lugar certo. Lê o código da tela.
 */

const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

/** O texto de um passo: do `{passo === n && (` ao próximo passo (ou à navegação). */
function passo(n: 1 | 2 | 3 | 4): string {
  const ini = TELA.indexOf(`{passo === ${n} && (`);
  expect(ini, `passo ${n}`).toBeGreaterThan(0);
  const proximo =
    n < 4 ? TELA.indexOf(`{passo === ${n + 1} && (`, ini) : TELA.indexOf("Voltar", ini);
  return TELA.slice(ini, proximo);
}

describe("os passos da tela da equipe", () => {
  it("usa a mesma barra de passos do parceiro", () => {
    expect(TELA).toContain("BarraDePassosDoOrcamento");
    expect(TELA).toContain("estadoDosPassosDaEquipe");
  });

  it("passo 1 — cliente, quem trouxe a venda e o preço (cliente final ou parceiro)", () => {
    const p = passo(1);
    expect(p).toContain("<QuemTrouxeAVenda");
    expect(p).toContain("<PrecoDoOrcamento");
    expect(p).toContain("canSeePrices");
  });

  it("passo 2 — os itens, com o formulário e a tabela de sempre", () => {
    const p = passo(2);
    expect(p).toContain('id="itens-do-orcamento"');
    expect(p).toContain("<EscolhaDeProduto");
    expect(p).toContain("salvarItem");
    expect(p).toContain("<Table>");
  });

  it("passo 3 — entrega, desconto, pagamento e observações, nesta ordem", () => {
    const p = passo(3);
    const ordem = ["<EntregaEPrazos", "<DescontoDoOrcamento", "<Pagamento", "<Observacoes"].map(
      (t) => p.indexOf(t),
    );
    expect(ordem.every((i) => i > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });

  it("passo 4 — a revisão traz PDF, via de produção, link, WhatsApp e o histórico de PDFs", () => {
    const p = passo(4);
    for (const trecho of [
      "setPreviewOpen(true)",
      "setPreviewProducaoOpen(true)",
      "copiarLinkCliente",
      "enviarWhatsApp",
      "<PDFHistoryCard",
    ]) {
      expect(p, trecho).toContain(trecho);
    }
    expect(p).toContain("podeMandar");
  });

  it("os botões de enviar saíram do cabeçalho, e o status e o 'Converter em OS' ficaram", () => {
    const ini = TELA.indexOf("<header");
    const fim = TELA.indexOf("</header>");
    const cabecalho = TELA.slice(ini, fim);
    expect(cabecalho).not.toContain("copiarLinkCliente");
    expect(cabecalho).not.toContain("enviarWhatsApp");
    expect(cabecalho).toContain("Status do orçamento");
    expect(cabecalho).toContain("Converter em OS");
    expect(cabecalho).toContain("Ver a OS");
  });

  it("o aviso de pendências e o desconto levam ao PASSO certo, não só rolam a página", () => {
    expect(TELA).toContain("irParaPasso(passoDaPendencia(p), alvo)");
    expect(TELA).toContain('irParaPasso(3, "acordo-desconto")');
    expect(TELA).not.toMatch(/getElementById\(alvo\)\?\.scrollIntoView[^;]*\}\)\}\n\s*>\s*\{p\}/);
  });

  it("o passo inicial é decidido uma vez, quando os dados chegam", () => {
    expect(TELA).toContain("passoInicialRef");
    expect(TELA).toContain("passoEscolhido ?? passoInicialRef.current");
    expect(TELA).toContain("consultaItens.isPending");
    expect(TELA).toContain("acordo.isPending");
  });

  it("o resumo fica ao lado em todos os passos, e o custo só aparece para quem vê financeiro", () => {
    const i = TELA.indexOf('data-testid="resumo-do-orcamento"');
    expect(i).toBeGreaterThan(0);
    const resumo = TELA.slice(i, TELA.indexOf("</aside>", i));
    expect(resumo).toContain("canSeePrices");
    expect(resumo).toMatch(/canSeeFinancials[\s\S]*custo_estimado/);
    expect(resumo.indexOf("custo_estimado")).toBeGreaterThan(resumo.indexOf("canSeeFinancials"));
  });

  it("a barra fixa existe só abaixo do computador, mostra o total e leva a ação do momento", () => {
    const i = TELA.indexOf('data-testid="barra-fixa-do-orcamento"');
    expect(i).toBeGreaterThan(0);
    const barra = TELA.slice(TELA.lastIndexOf("<div", i), TELA.indexOf("<DialogoDeLayouts", i));
    expect(barra).toContain("lg:hidden");
    expect(barra).toContain("converterEmOS");
    expect(barra).toContain("Ver a OS");
    expect(barra).toContain("rotuloDoAvancar(passo)");
    // quem não vê preço não vê o total
    expect(barra).toContain('canSeePrices ? "Total" : "Itens"');
  });

  it("Converter em OS continua exigindo permissão e desconto aprovado", () => {
    expect(TELA).toContain('hasPermission("orcamentos.convert")');
    expect(TELA).toMatch(
      /passo === 4 && aprovadoParaConverter[\s\S]*disabled=\{descontoPendente \|\| convertendo\}/,
    );
    expect(TELA).toContain('"converter_orcamento_em_os"');
  });
});
