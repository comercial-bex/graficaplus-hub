import { describe, expect, it } from "vitest";
import { brCodePix, crc16, linkDoWhatsapp, mensagemDoPix, normalizarChavePix, problemaNaChavePix, textoDoBrCode } from "@/domain/pagamento/pix";

describe("Pix copia e cola", () => {
  it("o CRC16 CCITT-FALSE confere com o vetor padrão ('123456789' = 29B1)", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
  it("gera o exemplo do manual do Banco Central (Fulano de Tal, sem valor) com o mesmo CRC", () => {
    const codigo = brCodePix({ chave: "123e4567-e12b-12d1-a456-426655440000", nome: "Fulano de Tal", cidade: "BRASILIA" });
    expect(codigo.startsWith("00020101021126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913FULANO DE TAL6008BRASILIA62070503***6304")).toBe(true);
    expect(codigo).toHaveLength(codigo.indexOf("6304") + 8);
    // o CRC do próprio texto bate
    expect(codigo.slice(-4)).toBe(crc16(codigo.slice(0, -4)));
  });
  it("com valor entra o campo 54 com duas casas e o CRC continua batendo", () => {
    const c = brCodePix({ chave: "12345678000199", valor: 123.2, nome: "Bex Print Ltda", cidade: "Macapá", identificador: "ORC132" });
    expect(c).toContain("5406123.20");
    expect(c).toContain("5914BEX PRINT LTDA");
    expect(c).toContain("6006MACAPA");
    expect(c).toContain("0506ORC132");
    expect(c.slice(-4)).toBe(crc16(c.slice(0, -4)));
  });
  it("limpa acento e corta o nome e a cidade no tamanho do padrão", () => {
    expect(textoDoBrCode("Gráfica São José & Filhos de Macapá Ltda", 25)).toBe("GRAFICA SAO JOSE FILHOS D");
    expect(textoDoBrCode("Santana do Amapá", 15)).toBe("SANTANA DO AMAP");
  });
});

describe("chave Pix", () => {
  it("normaliza por tipo", () => {
    expect(normalizarChavePix("cnpj", "12.345.678/0001-99")).toBe("12345678000199");
    expect(normalizarChavePix("telefone", "(96) 99123-4567")).toBe("+5596991234567");
    expect(normalizarChavePix("telefone", "5596991234567")).toBe("+5596991234567");
    expect(normalizarChavePix("email", " Financeiro@Bex.com.br ")).toBe("financeiro@bex.com.br");
  });
  it("aponta o que está errado", () => {
    expect(problemaNaChavePix("cpf", "123")).toMatch(/11/);
    expect(problemaNaChavePix("cnpj", "12345678000199")).toBeNull();
    expect(problemaNaChavePix("telefone", "+5596991234567")).toBeNull();
    expect(problemaNaChavePix("email", "sem-arroba")).toMatch(/inválido/);
    expect(problemaNaChavePix("aleatoria", "123e4567-e12b-12d1-a456-426655440000")).toBeNull();
    expect(problemaNaChavePix("cnpj", "")).toMatch(/Informe/);
  });
});

describe("mensagem e link", () => {
  it("a mensagem leva o primeiro nome, o valor e o copia e cola", () => {
    const m = mensagemDoPix({ cliente: "Maria da Silva", valor: 123.2, numeroDoOrcamento: 132, copiaECola: "000201...", empresa: "Bex Print" });
    expect(m).toContain("Olá, Maria!");
    expect(m).toContain("orçamento #132");
    expect(m).toMatch(/R\$\s?123,20/);
    expect(m).toContain("000201...");
  });
  it("o link coloca o 55 e escapa o texto", () => {
    expect(linkDoWhatsapp("(96) 99123-4567", "oi & tchau")).toBe("https://wa.me/5596991234567?text=oi%20%26%20tchau");
    expect(linkDoWhatsapp(null, "x")).toBe("https://wa.me/?text=x");
  });
});
