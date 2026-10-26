import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  caminhoDoComprovante,
  FORMATO_DO_CAMINHO_DO_COMPROVANTE,
  problemaNoComprovante,
} from "../src/domain/pagamento/comprovante";

const ID = "097c6f7d-846e-4573-a2bc-3944ac14fa70";
const le = (p: string) => readFileSync(p, "utf8");

describe("comprovante de pagamento", () => {
  it("aceita foto e PDF até 10 MB e recusa o resto", () => {
    expect(problemaNoComprovante({ nome: "pix.jpg", tipo: "image/jpeg", tamanho: 1000 })).toBeNull();
    expect(problemaNoComprovante({ nome: "pix.pdf", tipo: "application/pdf", tamanho: 1000 })).toBeNull();
    expect(problemaNoComprovante({ nome: "x.exe", tipo: "application/x-msdownload", tamanho: 10 })).toContain("foto");
    expect(problemaNoComprovante({ nome: "g.pdf", tipo: "application/pdf", tamanho: 11 * 1024 * 1024 })).toContain("10 MB");
    expect(problemaNoComprovante({ nome: "v.pdf", tipo: "application/pdf", tamanho: 0 })).toContain("vazio");
  });
  it("o caminho fica na pasta do orçamento e passa no formato que o servidor confere", () => {
    const c = caminhoDoComprovante(ID, "Comprovante São João (final).PDF", new Date(1792000000000));
    expect(c.startsWith(`orcamento/${ID}/`)).toBe(true);
    expect(FORMATO_DO_CAMINHO_DO_COMPROVANTE.test(c)).toBe(true);
    expect(FORMATO_DO_CAMINHO_DO_COMPROVANTE.test(`orcamento/${ID}/../../x`)).toBe(false);
  });
});

describe("onde o comprovante aparece", () => {
  it("o servidor confere o link do cliente e a existência do arquivo antes de gravar", () => {
    const s = le("src/lib/api/orcamento-comprovante.functions.ts");
    expect(s).toContain("token_publico");
    expect(s).toContain("O arquivo não chegou");
    expect(s).toContain('["enviado", "aprovado", "convertido"]');
  });
  it("marcar o Pix como recebido pede comprovante, ou a declaração de que conferiu o extrato", () => {
    const s = le("src/components/pagamento/pix-do-orcamento.tsx");
    expect(s).toContain("(!temComprovante && !conferiNoExtrato)");
    expect(s).toContain("sem_comprovante: true");
  });
  it("a página do cliente oferece o envio só depois da resposta", () => {
    const s = le("src/routes/orcamento-publico.$token.tsx");
    expect(s).toContain("{jaRespondido && <EnviarComprovanteDoCliente token={token} />}");
  });
  it("o olho do histórico de PDFs abre dentro do sistema", () => {
    const s = le("src/lib/pdf/PDFHistoryCard.tsx");
    expect(s).toContain("VisualizadorDeArquivo");
    expect(s).toContain('aria-label="Ver o PDF"');
  });
  it("a linha inteira é clicável na ficha do cliente e nas aprovações", () => {
    expect(le("src/routes/_authenticated/clientes.$id.tsx")).toContain('navigate({ to: "/orcamentos/$id", params: { id: o.id } })');
    expect(le("src/routes/_authenticated/aprovacoes.tsx")).toContain('navigate({ to: "/orcamentos/$id", params: { id: l.id } })');
  });
});
