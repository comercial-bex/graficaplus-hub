import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import QRCode from "qrcode";
import { brCodePix, crc16 } from "@/domain/pagamento/pix";

const PIX = readFileSync("src/components/pagamento/pix-do-orcamento.tsx", "utf8");
const CHAVE = readFileSync("src/components/configuracoes/chave-pix-da-empresa.tsx", "utf8");
const SQL = readFileSync("supabase/migrations/20261026600000_decisao_pix_automatico.sql", "utf8");
const PKG = JSON.parse(readFileSync("package.json", "utf8"));

describe("Pix de R$ 0,01 da Bex Print", () => {
  const codigo = brCodePix({ chave: "68726406000190", valor: 0.01, nome: "BEX PRINT", cidade: "Macapá", identificador: "TESTE" });
  it("é o texto exato entregue ao dono para o teste", () => {
    expect(codigo).toBe("00020101021126360014br.gov.bcb.pix01146872640600019052040000530398654040.015802BR5909BEX PRINT6006MACAPA62090505TESTE63043E6A");
  });
  it("o CRC confere e a chave e o valor estão onde o padrão manda", () => {
    expect(codigo.slice(-4)).toBe(crc16(codigo.slice(0, -4)));
    expect(codigo).toContain("0114" + "68726406000190");
    expect(codigo).toContain("54040.01");
  });
  it("o QR é gerado com o mesmo texto e cabe numa versão pequena", async () => {
    const qr = QRCode.create(codigo, { errorCorrectionLevel: "M" });
    expect(qr.version).toBeLessThanOrEqual(8);
    expect(qr.modules.size).toBeGreaterThan(20);
  });
});

describe("telas", () => {
  it("o orçamento mostra o QR e manda conferir recebedor e valor antes de enviar", () => {
    expect(PIX).toContain("<QrCodeDoPix texto={copiaECola} />");
    expect(PIX).toContain("Se aparecer outro nome ou valor, não envie.");
  });
  it("Dados da empresa tem o teste de R$ 0,01 para conferir no app do banco", () => {
    expect(CHAVE).toContain("Teste de R$ 0,01");
    expect(CHAVE).toContain("valor: 0.01");
  });
  it("a biblioteca do QR está nas dependências", () => {
    expect(PKG.dependencies.qrcode).toBeTruthy();
    expect(PKG.devDependencies["@types/qrcode"]).toBeTruthy();
  });
  it("a integração futura virou decisão pendente no painel", () => {
    expect(SQL).toContain("'pix_automatico_api_banco'");
    expect(SQL).toContain("ON CONFLICT (chave) DO NOTHING");
  });
});
