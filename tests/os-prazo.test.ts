import { describe, expect, it } from "vitest";
import {
  atrasado,
  dataLocal,
  diasAte,
  formatarDiaMes,
  paradaHa,
  prazoEmPalavras,
} from "../src/domain/os/prazo";

/**
 * O caso real que motivou o módulo.
 *
 * OS #49 "FAIXA BANNER", prazo_entrega = 2026-09-09. No dia 09/09/2026 o
 * Postgres respondia `prazo_entrega < current_date` = FALSE, e o Kanban exibia
 * o selo "Atrasada" com a data 08/09.
 */
const HOJE = new Date(2026, 8, 9, 15, 30); // 09/09/2026, 15h30 local

describe("data sem hora é dia do calendário, não instante em UTC", () => {
  it("lê 2026-09-09 como 9 de setembro, e não como 8", () => {
    const d = dataLocal("2026-09-09")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(9);
  });

  it("mostra a data que está no banco", () => {
    // Era aqui que o cartão escrevia 08/09 para um prazo de 09/09.
    expect(formatarDiaMes("2026-09-09")).toBe("09/09");
    expect(formatarDiaMes("2026-01-01")).toBe("01/01");
  });

  it("timestamp com fuso continua sendo lido como instante", () => {
    const d = dataLocal("2026-09-09T18:33:59.351138+00:00")!;
    expect(d.toISOString()).toBe("2026-09-09T18:33:59.351Z");
  });

  it("valor vazio ou inválido não vira data", () => {
    expect(dataLocal(null)).toBeNull();
    expect(dataLocal("")).toBeNull();
    expect(dataLocal("nem data")).toBeNull();
  });
});

describe("atrasada é a que venceu ANTES de hoje", () => {
  it("a que vence hoje não está atrasada", () => {
    // O caso da OS #49. Chamar de atrasada mandava a equipe correr atrás de um
    // prazo que ainda tem o dia inteiro pela frente.
    expect(atrasado("2026-09-09", HOJE)).toBe(false);
  });

  it("a de ontem está atrasada", () => {
    expect(atrasado("2026-09-08", HOJE)).toBe(true);
  });

  it("a de amanhã não está", () => {
    expect(atrasado("2026-09-10", HOJE)).toBe(false);
  });

  it("sem prazo não é atraso — é ausência de combinado", () => {
    expect(atrasado(null, HOJE)).toBe(false);
  });
});

describe("dias até o prazo", () => {
  it("conta em dias de calendário, sem sobra de horas", () => {
    // HOJE é 15h30: se a conta fosse por diferença bruta de milissegundos,
    // "amanhã" daria 0 dias e não 1.
    expect(diasAte("2026-09-09", HOJE)).toBe(0);
    expect(diasAte("2026-09-10", HOJE)).toBe(1);
    expect(diasAte("2026-09-08", HOJE)).toBe(-1);
    expect(diasAte("2026-09-19", HOJE)).toBe(10);
  });
});

describe("o prazo em palavras", () => {
  it("separa vence hoje de atrasada", () => {
    expect(prazoEmPalavras("2026-09-09", HOJE)).toEqual({ texto: "vence hoje", tom: "amber" });
    expect(prazoEmPalavras("2026-09-08", HOJE)).toEqual({
      texto: "1 dia de atraso",
      tom: "magenta",
    });
    expect(prazoEmPalavras("2026-09-05", HOJE)).toEqual({
      texto: "4 dias de atraso",
      tom: "magenta",
    });
  });

  it("avisa quando está chegando, e fica quieto quando está longe", () => {
    expect(prazoEmPalavras("2026-09-10", HOJE)?.tom).toBe("amber");
    expect(prazoEmPalavras("2026-09-12", HOJE)?.tom).toBe("amber");
    expect(prazoEmPalavras("2026-09-30", HOJE)?.tom).toBe("muted");
  });

  it("sem prazo não devolve frase", () => {
    expect(prazoEmPalavras(null, HOJE)).toBeNull();
  });
});

describe("há quanto tempo o cartão está parado", () => {
  it("responde a pergunta já resolvida, em vez de mostrar a data crua", () => {
    expect(paradaHa("2026-09-09T18:00:00.000Z", new Date("2026-09-09T18:30:00.000Z"))).toBe("agora");
    expect(paradaHa("2026-09-09T12:00:00.000Z", new Date("2026-09-09T18:00:00.000Z"))).toBe("6h");
    expect(paradaHa("2026-09-07T18:00:00.000Z", new Date("2026-09-09T18:00:00.000Z"))).toBe("2d");
  });

  it("data no futuro não vira tempo parado negativo", () => {
    expect(paradaHa("2026-09-10T18:00:00.000Z", new Date("2026-09-09T18:00:00.000Z"))).toBeNull();
  });
});
