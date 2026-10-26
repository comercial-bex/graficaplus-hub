import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tela = readFileSync("src/routes/_authenticated/orcamentos.index.tsx", "utf8");

describe("Novo orçamento: contato avulso vira cliente", () => {
  it("confere duplicata pelo telefone antes de cadastrar e não cadastra se a conferência falhar", () => {
    expect(tela).toContain('.eq("telefone_normalizado", chave)');
    expect(tela).toContain("if (erroBusca)");
    expect(tela).toContain("existente.length === 0");
  });
  it("vem marcado, pode desmarcar e só vale com telefone válido", () => {
    expect(tela).toContain("useState(true)");
    expect(tela).toContain("cadastrarContato && form.contato_nome.trim() && chaveWhatsApp(form.contato_telefone)");
  });
});
