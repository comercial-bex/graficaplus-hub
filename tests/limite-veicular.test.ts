import { test, expect } from "vitest";
import { pecasPorVeiculo, LIMITE_CARROCERIA_M2 } from "../src/domain/orcamentos/limite-veicular";

// Medidas do catálogo Campanha Política 2026. Os números batem com a conta feita
// no banco sobre produto_tamanhos.
test("bola 33 × 33 cabe 4 vezes por veículo", () => {
  expect(pecasPorVeiculo(0.33, 0.33)).toBe(4);
});

test("bolão 48 × 48 cabe 2 vezes", () => {
  expect(pecasPorVeiculo(0.48, 0.48)).toBe(2);
});

test("pragão 15 × 15 cabe 22 vezes", () => {
  expect(pecasPorVeiculo(0.15, 0.15)).toBe(22);
});

test("pragão 30 × 30 cabe 5 vezes", () => {
  expect(pecasPorVeiculo(0.3, 0.3)).toBe(5);
});

// Arredonda para baixo: a quinta bola estouraria o limite (5 × 0,1089 = 0,5445).
test("arredonda para baixo, nunca para cima", () => {
  expect(0.33 * 0.33 * 5).toBeGreaterThan(LIMITE_CARROCERIA_M2);
  expect(0.33 * 0.33 * 4).toBeLessThanOrEqual(LIMITE_CARROCERIA_M2);
});

test("peça maior que o limite não cabe nenhuma vez", () => {
  expect(pecasPorVeiculo(0.9, 0.9)).toBe(0);
});

test("sem medida não inventa conta", () => {
  expect(pecasPorVeiculo(null, 0.33)).toBeNull();
  expect(pecasPorVeiculo(0.33, undefined)).toBeNull();
  expect(pecasPorVeiculo(0, 0)).toBeNull();
});
