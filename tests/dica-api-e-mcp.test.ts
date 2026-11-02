import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dicaTela, dicaMenu } from "../src/lib/dicas";

describe("tela API e MCP tem dica", () => {
  it("o menu e o título têm texto e avisam que o token aparece uma vez", () => {
    expect(dicaMenu("/configuracoes-api")).toBeTruthy();
    expect(dicaTela("/configuracoes-api")).toContain("uma vez");
  });
  it("a tela mostra o ícone de ajuda ao lado do título", () => {
    const s = readFileSync("src/routes/_authenticated/configuracoes-api.tsx", "utf8");
    expect(s).toContain('dicaTela("/configuracoes-api")');
  });
});
