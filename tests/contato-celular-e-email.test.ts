import { describe, expect, it } from "vitest";
import {
  DOMINIOS_COM_ERRO, celularValido, completarEmail, erroDoCelular, erroDoEmail, mascaraCelular, sugerirDominio, sugerirEmailCorrigido,
} from "../src/domain/contato/celular-e-email";
import { readFileSync } from "node:fs";

describe("celular", () => {
  it("máscara (96) 99999-9999", () => {
    expect(mascaraCelular("96992061119")).toBe("(96) 99206-1119");
    expect(mascaraCelular("969")).toBe("(96) 9");
  });
  it("tira o 55 colado na frente", () => {
    expect(mascaraCelular("+55 96 99206-1119")).toBe("(96) 99206-1119");
    expect(mascaraCelular("5596992061119")).toBe("(96) 99206-1119");
    expect(celularValido("+55 (96) 99206-1119")).toBe(true);
  });
  it("faltando dígito", () => {
    expect(erroDoCelular("(96) 99206-11")).toBe("Faltam 2 números");
    expect(erroDoCelular("(96) 99206-111")).toBe("Falta 1 número");
  });
  it("DDD inválido", () => {
    expect(erroDoCelular("(20) 99206-1119")).toMatch(/DDD 20 não existe/);
    expect(celularValido("(10) 99206-1119")).toBe(false);
  });
  it("fixo de 8 dígitos é recusado", () => {
    expect(erroDoCelular("(96) 3223-1234")).toMatch(/fixo/);
    expect(celularValido("(96) 3223-1234")).toBe(false);
  });
});

describe("e-mail", () => {
  it("cada erro da lista vira o domínio certo", () => {
    for (const [errado, certo] of Object.entries(DOMINIOS_COM_ERRO)) {
      expect(sugerirDominio(errado)).toBe(certo);
      expect(erroDoEmail(`ana@${errado}`)).not.toBeNull();
    }
    expect(sugerirEmailCorrigido("Ana@Gmai.com")).toBe("ana@gmail.com");
  });
  it("domínio de empresa e provedores reais não mudam", () => {
    for (const d of ["graficaplus.com.br", "empresa.com", "hotmail.com.br", "outlook.com.br", "yahoo.com", "mail.com", "gmail.com"]) {
      expect(sugerirDominio(d)).toBeNull();
      expect(erroDoEmail(`ana@${d}`)).toBeNull();
    }
  });
  it("formato e botões", () => {
    expect(erroDoEmail("ana")).not.toBeNull();
    expect(completarEmail("ana@gm", "gmail.com")).toBe("ana@gmail.com");
  });
  it("o banco recusa a mesma lista de domínios", () => {
    const sql = readFileSync("supabase/migrations/20261116140000_cadastro_parceiro_telefone_email.sql", "utf8");
    for (const d of Object.keys(DOMINIOS_COM_ERRO)) expect(sql).toContain(`'${d}'`);
  });
});
