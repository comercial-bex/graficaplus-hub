import { describe, expect, it } from "vitest";
import {
  EXPLICACAO_ENTREGA,
  ROTULO_ENTREGA,
  STATUS_ENTREGA,
  STATUS_ENTREGA_ENCERRADOS,
  entregaEstaEncerrada,
  rotuloEntrega,
} from "../src/domain/os/entrega";

/**
 * O CONTRATO com o banco.
 *
 * `entregas_instalacoes.status` é text e ganhou CHECK em 24/09/2026 com estes
 * cinco valores. E `fechar_os` só deixa a OS fechar quando toda entrega está
 * em ('concluida','cancelada','nao_necessaria').
 *
 * A tela gravava 'concluido' e a função procurava 'concluida'. Dar baixa na
 * entrega, portanto, não desbloqueava nada: a OS ficava presa em "em entrega"
 * para sempre, fora do realizado do mês e do portal do cliente, sem erro
 * nenhum aparecer. Estes testes existem para que a divergência volte a falhar
 * aqui.
 */
const CHECK_DO_BANCO = ["agendada", "em_rota", "concluida", "cancelada", "nao_necessaria"];
const FECHAR_OS_ACEITA = ["concluida", "cancelada", "nao_necessaria"];

describe("o vocabulário da entrega bate com o banco", () => {
  it("a lista da tela é exatamente o CHECK da coluna", () => {
    expect([...STATUS_ENTREGA].sort()).toEqual([...CHECK_DO_BANCO].sort());
  });

  it("os status que não travam a OS são os que fechar_os aceita", () => {
    expect([...STATUS_ENTREGA_ENCERRADOS].sort()).toEqual([...FECHAR_OS_ACEITA].sort());
  });

  it("'concluido' no masculino não existe — era o defeito", () => {
    expect(CHECK_DO_BANCO).not.toContain("concluido");
    expect(entregaEstaEncerrada("concluido")).toBe(false);
    // E a tela não pode oferecer de volta: o banco recusaria a gravação.
    expect(STATUS_ENTREGA as readonly string[]).not.toContain("concluido");
  });

  it("todo status tem rótulo e explicação", () => {
    for (const s of STATUS_ENTREGA) {
      expect(ROTULO_ENTREGA[s], `${s} sem rótulo`).toBeTruthy();
      expect(EXPLICACAO_ENTREGA[s], `${s} sem explicação`).toBeTruthy();
    }
  });
});

describe("entregaEstaEncerrada", () => {
  it("agendada e em rota ainda travam o fechamento da OS", () => {
    expect(entregaEstaEncerrada("agendada")).toBe(false);
    expect(entregaEstaEncerrada("em_rota")).toBe(false);
  });

  it("concluída, cancelada e não necessária liberam", () => {
    expect(entregaEstaEncerrada("concluida")).toBe(true);
    expect(entregaEstaEncerrada("cancelada")).toBe(true);
    expect(entregaEstaEncerrada("nao_necessaria")).toBe(true);
  });

  it("nulo não encerra: entrega sem status é entrega pendente", () => {
    expect(entregaEstaEncerrada(null)).toBe(false);
    expect(entregaEstaEncerrada(undefined)).toBe(false);
  });
});

describe("rotuloEntrega", () => {
  it("devolve o rótulo conhecido", () => {
    expect(rotuloEntrega("nao_necessaria")).toBe("Não foi preciso");
  });

  it("palavra desconhecida aparece crua, e não some da tela", () => {
    // Um status estranho vindo do banco tem de ficar VISÍVEL. Traduzir para
    // "—" esconderia exatamente o tipo de divergência que causou este arquivo.
    expect(rotuloEntrega("xpto")).toBe("xpto");
  });
});
