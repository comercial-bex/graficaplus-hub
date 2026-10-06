import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LOGO_FUNDO_CLARO, PROPORCAO_DA_LOGO, urlDaLogoFundoClaro } from "../src/lib/marca";

/**
 * A logo oficial da Bex Print para fundo branco (mandada pelo dono em
 * 06/10/2026). Segura que o arquivo está onde o código aponta, que é PNG com
 * transparência e que a proporção declarada é a do arquivo — o cabeçalho do PDF
 * e a página do cliente reservam o espaço por ela.
 */

const RAIZ = join(__dirname, "..");
const arquivo = readFileSync(join(RAIZ, "public", LOGO_FUNDO_CLARO));

describe("logo para fundo branco", () => {
  it("o arquivo existe em /public e é PNG com canal alfa", () => {
    expect([...arquivo.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(arquivo[25]).toBe(6); // tipo de cor 6 = RGBA
  });

  it("a proporção declarada é a do arquivo", () => {
    const largura = arquivo.readUInt32BE(16);
    const altura = arquivo.readUInt32BE(20);
    expect([largura, altura]).toEqual([1165, 533]);
    expect(PROPORCAO_DA_LOGO).toBeCloseTo(largura / altura, 6);
  });

  it("a URL é absoluta no navegador e relativa fora dele", () => {
    expect(urlDaLogoFundoClaro("https://bexprint.com.br")).toBe(
      "https://bexprint.com.br/marca/bex-print-fundo-claro.png",
    );
    expect(urlDaLogoFundoClaro("")).toBe("/marca/bex-print-fundo-claro.png");
  });

  it("documento de parceiro não usa a logo da Bex Print", () => {
    // O PDF do parceiro monta a própria empresa (marca dele) e não passa por
    // carregarEmpresa, que é onde a logo da Bex Print entra.
    const pdfDoParceiro = readFileSync(join(RAIZ, "src/domain/parceiros/pdf.ts"), "utf8");
    expect(pdfDoParceiro).not.toMatch(/marca"|LOGO_FUNDO_CLARO|urlDaLogoFundoClaro|carregarEmpresa/);
  });
});
