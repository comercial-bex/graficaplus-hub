import { describe, expect, it } from "vitest";
import { sinalDeRetencao, type ResumoParaRetencao } from "../src/domain/parceiros/retencao";

const agora = new Date("2026-09-16T12:00:00-03:00");

const base = (parcial: Partial<ResumoParaRetencao>): ResumoParaRetencao => ({
  status: "ativo",
  criado_em: "2026-06-01T12:00:00-03:00",
  ultima_compra: "2026-09-10",
  dias_sem_comprar: 6,
  ultimo_acesso_em: "2026-09-15T09:00:00-03:00",
  orcamentos_30d: 0,
  ...parcial,
});

describe("sinal de retenção", () => {
  it("suspenso sai da fila de ligação", () => {
    expect(sinalDeRetencao(base({ status: "suspenso" }), agora)).toMatchObject({ chave: "inativo", rotulo: "Suspenso", urgencia: 0 });
  });

  it("comprou há pouco: comprando", () => {
    expect(sinalDeRetencao(base({}), agora)).toMatchObject({ chave: "ativo", tom: "lime" });
  });

  it("esfriando com orçamento no mês é negócio na mão", () => {
    const s = sinalDeRetencao(base({ dias_sem_comprar: 45, orcamentos_30d: 2 }), agora);
    expect(s.chave).toBe("esfriando");
    expect(s.detalhe).toBe("Sem comprar há 45 dias, mas fez 2 orçamentos no mês: tem negócio na mão.");
  });

  it("parado passa de 60 dias e é o mais urgente", () => {
    expect(sinalDeRetencao(base({ dias_sem_comprar: 90 }), agora)).toMatchObject({ chave: "parado", urgencia: 5 });
  });

  it("novo sem compra está começando, e diz se nunca abriu o painel", () => {
    const s = sinalDeRetencao(
      base({ criado_em: "2026-09-06T12:00:00-03:00", ultima_compra: null, dias_sem_comprar: null, ultimo_acesso_em: null }),
      agora,
    );
    expect(s.chave).toBe("comecando");
    expect(s.detalhe).toContain("ainda não abriu o painel");
  });

  it("antigo que nunca comprou pede atenção", () => {
    expect(
      sinalDeRetencao(base({ ultima_compra: null, dias_sem_comprar: null }), agora),
    ).toMatchObject({ chave: "sem_compra", urgencia: 4 });
  });
});
