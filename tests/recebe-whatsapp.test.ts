import { describe, expect, it } from "vitest";
import { chaveWhatsApp, recebeWhatsApp } from "../src/domain/documentos";

/**
 * O CONTRATO com o banco: `public.telefone_recebe_whatsapp`.
 *
 * Se as duas divergirem, a tela deixa salvar e o banco recusa — ou, pior, a
 * tela recusa o que o banco aceitaria. Os casos abaixo foram conferidos nos
 * dois lados em 28/09/2026.
 */
describe("o telefone recebe WhatsApp?", () => {
  it("aceita celular com DDD e o 9 na frente, em qualquer formatação", () => {
    for (const t of [
      "(96) 98121-6527",
      "96 98121-6527",
      "96981216527",
      "+55 96 98121-6527",
      "5596981216527",
      "11 98765-4321",
    ]) {
      expect(recebeWhatsApp(t), `devia aceitar ${t}`).toBe(true);
    }
  });

  it("recusa telefone fixo — não recebe mensagem", () => {
    // chaveWhatsApp aceita e normaliza; o que não pode é passar na validação.
    expect(chaveWhatsApp("96 3222-1234")).toBe("9632221234");
    expect(recebeWhatsApp("96 3222-1234")).toBe(false);
  });

  it("recusa dois números colados na mesma caixa", () => {
    // O pior caso: 22 dígitos gravados como se fossem um telefone. Quem digita
    // os dois números do cliente não vê nada de errado, e a mensagem some.
    const dois = "96 99131-8834 / 96 98140-8722";
    expect(chaveWhatsApp(dois)).toHaveLength(22);
    expect(recebeWhatsApp(dois)).toBe(false);
  });

  it("recusa vazio, nulo e texto", () => {
    expect(recebeWhatsApp("")).toBe(false);
    expect(recebeWhatsApp(null)).toBe(false);
    expect(recebeWhatsApp(undefined)).toBe(false);
    expect(recebeWhatsApp("abc")).toBe(false);
  });

  it("recusa DDD que não existe", () => {
    expect(recebeWhatsApp("01 99999-9999")).toBe(false);
    expect(recebeWhatsApp("00 99999-9999")).toBe(false);
  });

  it("o nono dígito acrescentado a um celular de 10 dígitos vale", () => {
    // chaveWhatsApp completa o 9 quando o primeiro dígito após o DDD é de 6 a 9.
    expect(chaveWhatsApp("96 8121-6527")).toBe("96981216527");
    expect(recebeWhatsApp("96 8121-6527")).toBe(true);
  });
});
