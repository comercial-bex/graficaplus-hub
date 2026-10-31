import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ETAPAS_QUADRO } from "../src/domain/os/etapas";

const kanban = readFileSync("src/routes/_authenticated/kanban.tsx", "utf8");
const apontamento = readFileSync("src/components/os/apontamento-card.tsx", "utf8");

describe("quadro de produção em uma linha e encerrar com quantidade (30/10/2026)", () => {
  it("o quadro não fixa o número de colunas: a sexta (Fila de produção) caía para a linha de baixo", () => {
    expect(ETAPAS_QUADRO.length).toBe(6);
    expect(kanban).not.toMatch(/repeat\(5,/);
    expect(kanban).not.toMatch(/md:grid-cols/);
  });

  it("a última coluna mostra os primeiros cartões e abre o resto num toque", () => {
    expect(kanban).toContain("LIMITE_DA_COLUNA_FINAL");
    expect(kanban).toContain("Mostrar as outras");
  });

  it("encerrar a produção na máquina exige a quantidade produzida", () => {
    expect(apontamento).toContain("Number(quantidades[a.id]) > 0");
    expect(apontamento).toContain("Informe a quantidade produzida");
  });
});
