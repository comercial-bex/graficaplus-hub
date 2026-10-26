import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pagina = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
const lista = readFileSync("src/routes/_authenticated/orcamentos.index.tsx", "utf8");

describe("Orçamento de impressão 3D abre na tela certa", () => {
  it("vai para o orçamento 3D só depois dos itens carregarem e sem itens comuns", () => {
    expect(pagina).toContain("consultaItens.isSuccess && itensDeProduto.length === 0");
    expect(pagina).toContain('to: "/orcamento-3d/$id"');
    expect(pagina).toContain("replace: true");
  });
  it("a linha da lista de um orçamento 3D leva ao orçamento 3D", () => {
    expect(lista).toContain('mapa3d[o.id]\n                      ? navigate({ to: "/orcamento-3d/$id"');
  });
});
