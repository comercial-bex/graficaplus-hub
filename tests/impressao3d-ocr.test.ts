import { test, expect } from "bun:test";
import { parseSlicerText, parseTempoLivre, formatMinutos } from "../src/domain/impressao3d/ocr";

test("prefere gramas com decimal quando ambos aparecem", () => {
  const r = parseSlicerText("Total 652 g\nModelo: 6,52 g");
  expect(r.gramas).toBe(6.52);
});

test("lê 6,52 g com vírgula decimal", () => {
  const r = parseSlicerText("Filament used: 6,52 g\nTime: 2h 3m");
  expect(r.gramas).toBe(6.52);
});

test("lê 6.52g com ponto decimal", () => {
  const r = parseSlicerText("6.52g used");
  expect(r.gramas).toBe(6.52);
});

test("tempo em minutos totais Xh Ym", () => {
  const r = parseSlicerText("Total time: 2h 3m");
  expect(r.minutos).toBe(123);
});

test("tempo em HH:MM", () => {
  const r = parseSlicerText("Print time 2:15");
  expect(r.minutos).toBe(135);
});

test("captura peso de suporte e purga", () => {
  const r = parseSlicerText("Modelo 42,09 g\nSuporte 3,10 g\nPrime tower 1,50 g");
  expect(r.pesoSuporteG).toBe(3.1);
  expect(r.pesoPurgaG).toBe(1.5);
});

test("captura tipo de filamento e infill", () => {
  const r = parseSlicerText("PETG · 20% infill · 0.2 mm layer height");
  expect(r.filamentoTipo).toBe("PETG");
  expect(r.infillPct).toBe(20);
  expect(r.alturaCamadaMm).toBe(0.2);
});

test("parseTempoLivre aceita formatos variados", () => {
  expect(parseTempoLivre("2h 15m")).toBe(135);
  expect(parseTempoLivre("2:15")).toBe(135);
  expect(parseTempoLivre("2:15:30")).toBe(135);
  expect(parseTempoLivre("135min")).toBe(135);
  expect(parseTempoLivre("1,5h")).toBe(90);
  expect(parseTempoLivre("90m")).toBe(90);
  expect(parseTempoLivre("90")).toBe(90);
  expect(parseTempoLivre("")).toBeUndefined();
});

test("formatMinutos formata corretamente", () => {
  expect(formatMinutos(135)).toBe("2h 15m");
  expect(formatMinutos(120)).toBe("2h");
  expect(formatMinutos(45)).toBe("45m");
});
