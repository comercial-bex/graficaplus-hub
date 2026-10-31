import { describe, expect, it } from "vitest";
import {
  MAXIMO_DE_RODADAS,
  repartirRodadas,
  rodadasDoPedido,
  simularUso,
} from "../src/domain/impressao3d/uso-das-maquinas";

describe("uso das impressoras por uma OS 3D (30/10/2026)", () => {
  it("100 kits de 110 min, um por placa: 183,3 h no total, como o motor de custo", () => {
    const s = simularUso({ pecas: 100, pecasPorPlaca: 1, minutosPorRodada: 110 }, 4);
    expect(s.rodadas).toBe(100);
    expect(s.horasTotais).toBe(183.3);
  });

  it("quanto cai com 1, 2, 3 e 4 impressoras (dia útil de 10 h)", () => {
    const s = simularUso({ pecas: 100, pecasPorPlaca: 1, minutosPorRodada: 110 }, 4);
    expect(s.cenarios.map((c) => [c.maquinas, c.rodadasNaMaisCarregada, c.diasUteis])).toEqual([
      [1, 100, 19],
      [2, 50, 10],
      [3, 34, 7],
      [4, 25, 5],
    ]);
  });

  it("peças por placa divide o pedido, arredondando para cima", () => {
    expect(rodadasDoPedido(50, 8)).toBe(7);
    expect(rodadasDoPedido(50, 0)).toBe(50);
    expect(rodadasDoPedido(0, 4)).toBe(0);
  });

  it("a repartição vai sempre para a impressora menos carregada", () => {
    expect(repartirRodadas(100, 110, [0, 0, 0, 0])).toEqual([25, 25, 25, 25]);
    expect(repartirRodadas(5, 60, [0, 0])).toEqual([3, 2]);
    // uma impressora já ocupada com 4 h recebe menos
    expect(repartirRodadas(6, 60, [240, 0])).toEqual([1, 5]);
    expect(repartirRodadas(3, 60, [])).toEqual([]);
  });

  it("avisa quando o pedido passa do teto de rodadas", () => {
    expect(simularUso({ pecas: MAXIMO_DE_RODADAS + 1, pecasPorPlaca: 1, minutosPorRodada: 30 }, 2).excedeOTeto).toBe(true);
    expect(simularUso({ pecas: MAXIMO_DE_RODADAS, pecasPorPlaca: 1, minutosPorRodada: 30 }, 2).excedeOTeto).toBe(false);
  });
});
