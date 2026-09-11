import { describe, expect, it } from "vitest";
import { MOTIVOS_ORFAO, ehOrfao, resumoDaLimpeza, rotuloOrfao } from "../src/domain/avisos/orfao";

/**
 * O CONTRATO com a view.
 *
 * Estes são os valores que `vw_avisos_pendentes.motivo_orfao` devolve,
 * conferidos no Postgres em 11/09/2026. Mudou o CASE da view? Atualize aqui na
 * mesma migração.
 */
const CASE_DA_VIEW = ["sem_cliente", "cliente_apagado", "registro_apagado"];

describe("a tela conhece os mesmos tipos de órfão que o banco", () => {
  it("nenhum tipo do banco fica sem frase", () => {
    expect([...MOTIVOS_ORFAO].sort()).toEqual([...CASE_DA_VIEW].sort());
    for (const m of CASE_DA_VIEW) {
      expect(rotuloOrfao(m)?.curto, `sem frase para ${m}`).toBeTruthy();
    }
  });
});

describe("o que conta como órfão", () => {
  it("o caso real: serviço apagado, cliente existente", () => {
    // Os 7 avisos de 11/09 tinham cliente. A tela antiga olhava só para
    // "tem cliente?" e os tratava como avisos reais.
    expect(ehOrfao("registro_apagado")).toBe(true);
    expect(rotuloOrfao("registro_apagado")?.curto).toBe("OS ou orçamento apagado");
  });

  it("aviso legítimo não é órfão", () => {
    expect(ehOrfao(null)).toBe(false);
    expect(ehOrfao(undefined)).toBe(false);
    expect(rotuloOrfao(null)).toBeNull();
  });

  it("tipo novo que a tela não conhece continua sendo órfão", () => {
    // Quem decide é a view. Se a tela tratasse o desconhecido como aviso real,
    // um tipo novo de órfão voltaria a aparecer com o botão "Já avisei".
    expect(ehOrfao("motivo_futuro")).toBe(true);
    expect(rotuloOrfao("motivo_futuro")?.explicacao).toContain("motivo_futuro");
  });
});

describe("o resumo da limpeza conta o que a escrita fez", () => {
  it("zero é dito como zero, não como sucesso vago", () => {
    expect(resumoDaLimpeza({ cancelados: 0 })).toBe("Nenhum aviso órfão para limpar");
    expect(resumoDaLimpeza(null)).toBe("Nenhum aviso órfão para limpar");
  });

  it("separa por tipo — o caso real de 11/09", () => {
    expect(
      resumoDaLimpeza({ cancelados: 7, sem_cliente: 0, cliente_apagado: 0, registro_apagado: 7 }),
    ).toBe("7 aviso(s) cancelado(s): 7 de serviço apagado");
  });

  it("junta os tipos quando há mais de um", () => {
    expect(
      resumoDaLimpeza({ cancelados: 4, sem_cliente: 1, cliente_apagado: 1, registro_apagado: 2 }),
    ).toBe("4 aviso(s) cancelado(s): 2 de serviço apagado, 1 de cliente apagado, 1 sem cliente");
  });
});
