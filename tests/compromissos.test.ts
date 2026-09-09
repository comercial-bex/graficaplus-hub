import { describe, expect, it } from "vitest";
import {
  custoMensal,
  parcelaAtual,
  progresso,
  saldoDevedorTotal,
  pendencias,
  situacao,
  terminaEm,
  totalAtrasado,
  totalPresumido,
  type Compromisso,
} from "../src/domain/financeiro/compromissos";

const base: Compromisso = {
  id: "c1",
  descricao: "Locação i1600",
  credor: "BLIPS",
  tipo: "locacao",
  numero_contrato: "12608505",
  observacoes: null,
  maquina_id: null,
  financeira: "Bradesco",
  portal_url: null,
  cronograma_confirmado: true,
  com_comprovante: 0,
  sem_comprovante: 0,
  valor_parcela: 2309,
  total_parcelas: 36,
  primeira_parcela: "2026-06-05",
  periodicidade: "mensal",
  valor_entrada: 2309,
  valor_total: 85433,
  ativo: true,
  parcelas_geradas: 36,
  parcelas_pagas: 0,
  valor_pago: 0,
  parcelas_abertas: 36,
  valor_aberto: 83124,
  parcelas_atrasadas: 4,
  valor_atrasado: 9236,
  proximo_vencimento: "2026-06-05",
  ultimo_vencimento: "2029-05-05",
  saldo_devedor: 83124,
};

const com = (p: Partial<Compromisso>): Compromisso => ({ ...base, ...p });

describe("quanto sai por mês", () => {
  it("soma os dois contratos reais da casa", () => {
    const cnc = com({ id: "c2", valor_parcela: 1750.38, saldo_devedor: 63013.68 });
    expect(custoMensal([base, cnc])).toBeCloseTo(4059.38, 2);
  });

  it("periodicidades diferentes entram na mesma régua", () => {
    // R$ 1.200 por ano não pesa como R$ 1.200 por mês.
    const anual = com({ valor_parcela: 1200, periodicidade: "anual" });
    expect(custoMensal([anual])).toBeCloseTo(100, 2);
    const trimestral = com({ valor_parcela: 300, periodicidade: "trimestral" });
    expect(custoMensal([trimestral])).toBeCloseTo(100, 2);
  });

  it("contrato quitado sai do custo mensal — senão inflaria para sempre", () => {
    const quitado = com({ parcelas_pagas: 36, parcelas_abertas: 0, valor_pago: 83124 });
    expect(custoMensal([quitado])).toBe(0);
  });

  it("contrato inativo também sai", () => {
    expect(custoMensal([com({ ativo: false })])).toBe(0);
  });
});

describe("saldo devedor", () => {
  it("soma só o que ainda falta pagar", () => {
    const cnc = com({ id: "c2", valor_parcela: 1750.38, saldo_devedor: 63013.68 });
    expect(saldoDevedorTotal([base, cnc])).toBeCloseTo(146137.68, 2);
  });

  it("compromisso sem fim não tem saldo — e não vira zero somado errado", () => {
    const aluguel = com({ total_parcelas: null, saldo_devedor: null });
    expect(saldoDevedorTotal([aluguel])).toBe(0);
  });

  it("pago a mais não vira saldo negativo abatendo os outros", () => {
    const pagoDemais = com({ saldo_devedor: -500 });
    const cnc = com({ id: "c2", saldo_devedor: 1000 });
    expect(saldoDevedorTotal([pagoDemais, cnc])).toBe(1000);
  });
});

describe("em que parcela estou", () => {
  it("é a contagem de pagas mais um, não o mês do calendário", () => {
    // Quatro venceram e nenhuma foi paga: ainda estou na primeira.
    expect(parcelaAtual(base)).toEqual({ numero: 1, de: 36 });
    expect(parcelaAtual(com({ parcelas_pagas: 7 }))).toEqual({ numero: 8, de: 36 });
  });

  it("na última parcela paga não passa do total", () => {
    expect(parcelaAtual(com({ parcelas_pagas: 36 }))?.numero).toBe(36);
  });

  it("compromisso sem fim não tem parcela atual", () => {
    expect(parcelaAtual(com({ total_parcelas: null }))).toBeNull();
  });
});

describe("progresso e término", () => {
  it("progresso é sobre o valor pago, não sobre parcelas geradas", () => {
    expect(progresso(base)).toBe(0);
    expect(progresso(com({ parcelas_pagas: 18, valor_pago: 41562 }))).toBeCloseTo(0.5, 3);
  });

  it("progresso não passa de 100% com pagamento a mais", () => {
    expect(progresso(com({ valor_pago: 999999 }))).toBe(1);
  });

  it("a data de término sai do contrato, não das parcelas geradas", () => {
    // 05/06/2026 + 35 meses = 05/05/2029, o que o banco calculou.
    expect(terminaEm(com({ parcelas_geradas: 0 }))?.toISOString().slice(0, 10)).toBe("2029-05-05");
  });

  it("anual conta em anos, não em meses", () => {
    const anual = com({ periodicidade: "anual", total_parcelas: 3, primeira_parcela: "2026-01-10" });
    expect(terminaEm(anual)?.toISOString().slice(0, 10)).toBe("2028-01-10");
  });

  it("sem fim não tem data de término", () => {
    expect(terminaEm(com({ total_parcelas: null }))).toBeNull();
  });
});

describe("situação", () => {
  it("atraso vem primeiro", () => {
    expect(situacao(base)).toBe("atrasado");
  });

  it("cadastrado e sem nenhuma parcela gerada é o estado que mais engana", () => {
    // Aparece na lista, nada vence, nada atrasa, e o fluxo de caixa não sabe
    // que ele existe.
    const semParcelas = com({ parcelas_geradas: 0, parcelas_abertas: 0, parcelas_atrasadas: 0 });
    expect(situacao(semParcelas)).toBe("sem_parcelas");
  });

  it("quitado quando todas as parcelas foram pagas", () => {
    expect(situacao(com({ parcelas_pagas: 36, parcelas_atrasadas: 0 }))).toBe("quitado");
  });

  it("sem fim nunca fica quitado", () => {
    const semFim = com({ total_parcelas: null, parcelas_pagas: 99, parcelas_atrasadas: 0 });
    expect(situacao(semFim)).toBe("em_dia");
  });
});

describe("atrasado x presumido", () => {
  it("soma o atraso de todos os conferidos, inclusive o inativo — dívida não some por desligar o contrato", () => {
    expect(totalAtrasado([base, com({ ativo: false, valor_atrasado: 100 })])).toBe(9336);
  });

  it("data que eu presumi NÃO vira número vermelho", () => {
    // O cronograma do contrato do CNC errou a 1ª parcela em dois meses. Cobrar
    // atraso em cima de uma data dessas é inventar dívida.
    const presumido = com({ cronograma_confirmado: false, valor_atrasado: 9236 });
    expect(totalAtrasado([presumido])).toBe(0);
    expect(totalPresumido([presumido])).toBe(9236);
  });

  it("os dois totais são disjuntos: nada é contado duas vezes", () => {
    const lista = [base, com({ id: "c2", cronograma_confirmado: false, valor_atrasado: 500 })];
    expect(totalAtrasado(lista) + totalPresumido(lista)).toBe(9236 + 500);
  });

  it("cronograma não conferido tem situação própria, e ela vem antes de atrasado", () => {
    expect(situacao(com({ cronograma_confirmado: false }))).toBe("cronograma_presumido");
    expect(situacao(base)).toBe("atrasado");
  });

  it("sem parcela nenhuma, a situação é essa — não a de cronograma presumido", () => {
    const c = com({ cronograma_confirmado: false, parcelas_geradas: 0 });
    expect(situacao(c)).toBe("sem_parcelas");
  });

  it("a pendência de atraso muda de tom conforme o cronograma foi conferido", () => {
    expect(pendencias(base).join(" ")).toContain("vencida(s) sem baixa");
    const presumido = com({ cronograma_confirmado: false });
    expect(pendencias(presumido).join(" ")).toContain("apareceriam vencidas");
    expect(pendencias(presumido).join(" ")).not.toContain("sem baixa");
  });
});

describe("o que falta para estar em ordem", () => {
  it("parcela paga sem comprovante é o caso silencioso: some do saldo e não deixa prova", () => {
    const c = com({ parcelas_pagas: 3, sem_comprovante: 3, parcelas_atrasadas: 0 });
    expect(pendencias(c)).toContain("3 parcela(s) dada(s) como paga(s) sem comprovante anexado");
  });

  it("cronograma não conferido aparece enquanto o boleto não bateu com o contrato", () => {
    const c = com({ cronograma_confirmado: false, parcelas_atrasadas: 0 });
    expect(pendencias(c)[0]).toContain("não foi conferido no boleto");
  });

  it("sem parcela lançada, essa é a pendência — não a de cronograma", () => {
    const c = com({ parcelas_geradas: 0, cronograma_confirmado: false, parcelas_atrasadas: 0 });
    expect(pendencias(c)[0]).toContain("ainda não foram lançadas");
    expect(pendencias(c).join(" ")).not.toContain("conferido no boleto");
  });

  it("compromisso em ordem não inventa pendência", () => {
    const c = com({ parcelas_atrasadas: 0, sem_comprovante: 0, com_comprovante: 1, parcelas_pagas: 1 });
    expect(pendencias(c)).toEqual([]);
  });

  it("atraso e comprovante faltando aparecem juntos, na ordem de peso", () => {
    const c = com({ parcelas_atrasadas: 2, sem_comprovante: 1, parcelas_pagas: 1 });
    const r = pendencias(c);
    expect(r).toHaveLength(2);
    expect(r[0]).toContain("vencida");
    expect(r[1]).toContain("comprovante");
  });
});
