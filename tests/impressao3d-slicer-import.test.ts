import { test, expect } from "bun:test";
import { parseSlicerImport } from "../src/domain/impressao3d/slicer-import";

test("GenericGCodeParser extrai tempo, peso e hash", () => {
  const input = Buffer.from("; estimated printing time: 2h 3m 4s\n; filament used [g]: 42.5\nG1 X0 Y0");
  const parsed = parseSlicerImport(input, "peca.gcode", "text/plain");
  expect(parsed.parser).toBe("GenericGCodeParser");
  expect(parsed.sha256).toHaveLength(64);
  expect(parsed.data.totalTimeSeconds).toBe(7384);
  expect(parsed.data.totalWeightG).toBe(42.5);
});

test("valida extensão de importação", () => {
  expect(() => parseSlicerImport(Buffer.from("x"), "peca.exe", "application/octet-stream")).toThrow();
});
