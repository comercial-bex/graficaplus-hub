import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const le = (f: string) => readFileSync(`src/routes/_authenticated/${f}`, "utf8");

describe("telas que listavam 'Nenhum…' enquanto os dados ainda chegavam", () => {
  it("pós-venda mostra carregando antes do vazio, nas duas listas", () => {
    const s = le("pos-venda.tsx");
    expect(s).toContain("isLoading: carregandoPesquisas");
    expect(s).toContain("isLoading: carregandoRespostas");
    expect(s.indexOf("carregandoPesquisas ? (")).toBeLessThan(s.indexOf("pesquisas.length === 0"));
    expect(s.indexOf("carregandoRespostas ? (")).toBeLessThan(s.indexOf("respostas.length === 0"));
  });
  it("produção 3D mostra carregando antes do vazio, em jobs e apontamentos", () => {
    const s = le("producao-3d.tsx");
    expect(s.indexOf("carregandoJobs ? (")).toBeLessThan(s.indexOf("jobs.length === 0"));
    expect(s.indexOf("carregandoApontamentos ? (")).toBeLessThan(s.indexOf("apontamentos.length === 0"));
  });
});
