import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tela = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

describe("Cliente aprovou: converter em OS num clique", () => {
  it("aprova pela função do banco (com observação) antes de converter", () => {
    expect(tela).toContain('"aprovar_orcamento"');
    expect(tela).toContain("Aprovado pela equipe");
    expect(tela).toContain('converterEmOS(conferindo === "enviado")');
    expect(tela).toContain('setConferindo("enviado")');
  });
  it("só aparece em orçamento enviado, para quem converte e aprova", () => {
    expect(tela).toContain('orc.status === "enviado" && podeConverter && hasPermission("orcamentos.approve")');
  });
  it("o botão antigo continua chamando sem aprovar", () => {
    expect(tela).toContain('setConferindo("aprovado")');
  });
});
