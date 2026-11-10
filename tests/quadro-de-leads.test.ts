import { describe, expect, it } from "vitest";
import { canalDaOrigem, origemAgrupada } from "@/domain/crm/origens";
import {
  avisoDeOrcamentos,
  contagemPorAba,
  leadsDaAba,
  montarQuadro,
  valorDoCartao,
} from "@/domain/crm/quadro-de-leads";

const ETAPAS = ["lead", "cliente", "orcado", "fechado", "em producao", "entregue", "perdido"];
const L = (
  id: string,
  origem: string | null,
  estagio: string,
  orc: number,
  vo: number,
  vp: number,
) => ({
  lead_id: id,
  origem,
  estagio,
  orcamentos: orc,
  valor_orcado: vo,
  valor_potencial: vp,
});

describe("canalDaOrigem", () => {
  it("whatsapp e WhatsApp caem no mesmo canal", () => {
    expect(canalDaOrigem("whatsapp")).toBe("whatsapp");
    expect(canalDaOrigem("WhatsApp")).toBe("whatsapp");
  });
  it("Instagram e 'facebook ' reconhecidos", () => {
    expect(canalDaOrigem("Instagram")).toBe("instagram");
    expect(canalDaOrigem("facebook ")).toBe("facebook");
  });
  it("Indicação e vazio são outros", () => {
    expect(canalDaOrigem("Indicação")).toBe("outros");
    expect(canalDaOrigem(null)).toBe("outros");
  });
  it("Por origem junta as duas grafias e mantém as outras", () => {
    expect(origemAgrupada("whatsapp")).toBe("WhatsApp");
    expect(origemAgrupada("Indicação")).toBe("Indicação");
  });
});

describe("valorDoCartao", () => {
  it("usa o orçado quando há orçamento com valor", () => {
    expect(valorDoCartao({ orcamentos: 1, valor_orcado: 500, valor_potencial: 900 })).toEqual({
      valor: 500,
      fonte: "orcado",
    });
  });
  it("usa o potencial quando não há orçado", () => {
    expect(valorDoCartao({ orcamentos: 0, valor_orcado: 0, valor_potencial: 300 })).toEqual({
      valor: 300,
      fonte: "potencial",
    });
  });
  it("sem nenhum, nada", () => {
    expect(valorDoCartao({ orcamentos: 1, valor_orcado: 0, valor_potencial: 0 })).toBeNull();
  });
});

describe("montarQuadro", () => {
  const leads = [
    L("a", "whatsapp", "orcado", 1, 500, 0),
    L("b", "WhatsApp", "orcado", 1, 200, 0),
    L("c", "Indicação", "entregue", 1, 1000, 0),
    L("d", "whatsapp", "perdido", 0, 0, 300),
    L("e", "whatsapp", "lead", 0, 0, 0),
  ];
  it("soma por coluna", () => {
    const q = montarQuadro(leads, ETAPAS);
    const orcado = q.colunas.find((c) => c.chave === "orcado")!;
    expect(orcado.quantidade).toBe(2);
    expect(orcado.soma).toBe(700);
  });
  it("total da aba e em aberto", () => {
    const q = montarQuadro(leads, ETAPAS);
    expect(q.totalDaAba).toBe(2000);
    expect(q.emAberto).toBe(700);
  });
  it("aba WhatsApp conta as duas grafias", () => {
    expect(contagemPorAba(leads).whatsapp).toBe(4);
    expect(montarQuadro(leadsDaAba(leads, "whatsapp"), ETAPAS).totalDaAba).toBe(1000);
  });
  it("aba vazia", () => {
    const q = montarQuadro(leadsDaAba(leads, "instagram"), ETAPAS);
    expect(q.vazio).toBe(true);
    expect(q.totalDaAba).toBe(0);
    expect(contagemPorAba(leads).instagram).toBe(0);
  });
});
