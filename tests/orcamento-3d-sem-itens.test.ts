import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pagina = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
const lista = readFileSync("src/routes/_authenticated/orcamentos.index.tsx", "utf8");

describe("Orçamento de impressão 3D vive no orçamento comum", () => {
  it("a tela do orçamento não desvia mais para o módulo 3D: lê as peças e abre a calculadora", () => {
    expect(pagina).not.toContain('to: "/orcamento-3d/$id"');
    expect(pagina).toContain('queryKey: ["pecas-3d-do-orcamento", id]');
    expect(pagina).toContain('<Calculadora3D');
    expect(pagina).toContain('modo="embutido"');
  });
  it("a linha da lista sempre abre o orçamento; a peça 3D é escolhida dentro dele", () => {
    expect(lista).toContain('onClick={() => navigate({ to: "/orcamentos/$id", params: { id: o.id } })}');
    expect(lista).toContain('sessionStorage.setItem("bex.orcamento.abrir3d", novoId)');
  });
});
