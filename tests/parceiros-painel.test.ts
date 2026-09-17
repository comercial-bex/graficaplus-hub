import { describe, expect, it } from "vitest";
import {
  ofertasParaAvisar,
  progressoDaMeta,
  progressoDoNivel,
  quantidadeDaMetrica,
  resumoDaOferta,
  situacaoDoPedido,
  textoDaRecompensa,
  validadeDoOrcamento,
  type Campanha,
  type NivelAtual,
  type NivelDaRegua,
  type Oferta,
} from "../src/domain/parceiros/painel";

const sp = (t: string) => t.replace(/ /g, " ");

const niveis: NivelDaRegua[] = [
  { id: "bronze", nome: "Bronze", ordem: 1, compra_minima_90d: 0, desconto_pct: 10, cashback_pct: 0, cor: "#b07a4a", beneficios: [] },
  { id: "prata", nome: "Prata", ordem: 2, compra_minima_90d: 1500, desconto_pct: 15, cashback_pct: 1, cor: "#9aa4b2", beneficios: [] },
  { id: "ouro", nome: "Ouro", ordem: 3, compra_minima_90d: 5000, desconto_pct: 20, cashback_pct: 2, cor: "#d4a72c", beneficios: [] },
];

const nivel = (parcial: Partial<NivelAtual>): NivelAtual => ({
  id: "bronze",
  nome: "Bronze",
  ordem: 1,
  cor: "#b07a4a",
  desconto_pct: 10,
  desconto_faixa_pct: 0,
  cashback_pct: 0,
  beneficios: [],
  fixado: false,
  compras_90d: 0,
  proximo: { nome: "Prata", compra_minima_90d: 1500, falta: 1500, desconto_pct: 15 },
  ...parcial,
});

describe("nível", () => {
  it("mede do piso do nível atual ao piso do próximo e diz quanto falta", () => {
    const p = progressoDoNivel(nivel({ compras_90d: 1200, proximo: { nome: "Prata", compra_minima_90d: 1500, falta: 300, desconto_pct: 15 } }), niveis);
    expect(p.pct).toBe(80);
    expect(sp(p.titulo)).toBe("Faltam R$ 300,00 para Prata");
    expect(sp(p.detalhe)).toContain("o desconto sobe para 15%");
  });

  it("começa do piso do nível, não do zero", () => {
    const p = progressoDoNivel(
      nivel({ id: "prata", nome: "Prata", compras_90d: 3250, proximo: { nome: "Ouro", compra_minima_90d: 5000, falta: 1750, desconto_pct: 20 } }),
      niveis,
    );
    expect(p.pct).toBe(50);
  });

  it("nível fixado pela gestão com compras abaixo do piso não fica negativo", () => {
    const p = progressoDoNivel(
      nivel({ id: "prata", nome: "Prata", fixado: true, compras_90d: 200, proximo: { nome: "Ouro", compra_minima_90d: 5000, falta: 4800, desconto_pct: 20 } }),
      niveis,
    );
    expect(p.pct).toBe(0);
  });

  it("no topo não há próximo", () => {
    const p = progressoDoNivel(nivel({ id: "ouro", nome: "Ouro", proximo: null, compras_90d: 9000 }), niveis);
    expect(p).toMatchObject({ pct: 100, maximo: true, titulo: "Você está no nível mais alto: Ouro" });
  });
});

const campanha = (parcial: Partial<Campanha>): Campanha => ({
  id: "c1",
  titulo: "Setembro forte",
  descricao: null,
  metrica: "valor_compras",
  meta: 1000,
  inicio: "2026-09-01",
  fim: "2026-09-28",
  recompensa_tipo: "credito",
  recompensa_valor: 50,
  recompensa_descricao: "R$ 50 em crédito",
  atual: 800,
  conquistada: false,
  ...parcial,
});

describe("metas", () => {
  const agora = new Date(2026, 8, 16, 10, 0);

  it("diz andamento, quanto falta e o prazo", () => {
    const p = progressoDaMeta(campanha({}), agora);
    expect(p.pct).toBe(80);
    expect(sp(p.andamento)).toBe("R$ 800,00 de R$ 1.000,00");
    expect(sp(p.falta)).toBe("Faltam R$ 200,00");
    expect(p.prazo).toBe("Faltam 12 dias");
  });

  it("conquistada fecha em 100% mesmo se o valor oscilou depois", () => {
    const p = progressoDaMeta(campanha({ conquistada: true, atual: 700 }), agora);
    expect(p).toMatchObject({ pct: 100, conquistada: true, falta: "Meta batida" });
  });

  it("prazo do último dia e do dia seguinte", () => {
    expect(progressoDaMeta(campanha({ fim: "2026-09-16" }), agora).prazo).toBe("Termina hoje");
    expect(progressoDaMeta(campanha({ fim: "2026-09-17" }), agora).prazo).toBe("Termina amanhã");
  });

  it("fala a unidade de cada métrica", () => {
    expect(quantidadeDaMetrica("metragem_compras", 12.5)).toBe("12,5 m²");
    expect(quantidadeDaMetrica("quantidade_pedidos", 1)).toBe("1 pedido");
    expect(quantidadeDaMetrica("quantidade_pedidos", 3)).toBe("3 pedidos");
  });

  it("recompensa em crédito diz o valor; produto diz o que é", () => {
    expect(sp(textoDaRecompensa(campanha({})))).toBe("R$ 50,00 em crédito");
    expect(
      textoDaRecompensa(campanha({ recompensa_tipo: "produto", recompensa_valor: null, recompensa_descricao: "4 m² de lona" })),
    ).toBe("4 m² de lona");
  });
});

describe("ofertas", () => {
  const oferta = (parcial: Partial<Oferta>): Oferta => ({
    id: "o",
    titulo: "Lona em promoção",
    mensagem: "Só esta semana",
    produto_id: "lona",
    produto_nome: "Lona 440g",
    produto_unidade: "m2",
    preco_oferta: 55,
    fim: "2026-09-30T23:59:00-03:00",
    exibir_popup: true,
    vista: false,
    ...parcial,
  });

  it("avisa só as marcadas e não vistas, a que acaba antes primeiro", () => {
    const lista = ofertasParaAvisar([
      oferta({ id: "tarde", fim: "2026-09-30T12:00:00-03:00" }),
      oferta({ id: "vista", vista: true }),
      oferta({ id: "sem-aviso", exibir_popup: false }),
      oferta({ id: "cedo", fim: "2026-09-20T12:00:00-03:00" }),
    ]);
    expect(lista.map((o) => o.id)).toEqual(["cedo", "tarde"]);
  });

  it("resume em uma frase", () => {
    expect(sp(resumoDaOferta(oferta({})))).toBe("Lona 440g por R$ 55,00/m² até 30/09");
  });
});

describe("pedido em palavras do parceiro", () => {
  it("antes de virar OS está recebido", () => {
    expect(situacaoDoPedido({ pedido_status: "aprovado", os_status: null })).toEqual({
      rotulo: "Recebido — aguardando produção",
      passo: 0,
      tom: "cyan",
    });
  });

  it("segue as etapas do quadro de produção", () => {
    expect(situacaoDoPedido({ pedido_status: "convertido", os_status: "em_impressao" })).toMatchObject({ passo: 2, rotulo: "Em produção" });
    expect(situacaoDoPedido({ pedido_status: "convertido", os_status: "em_acabamento" })).toMatchObject({ passo: 3 });
    expect(situacaoDoPedido({ pedido_status: "convertido", os_status: "aguardando_retirada" })).toMatchObject({ passo: 4 });
    expect(situacaoDoPedido({ pedido_status: "convertido", os_status: "faturado" })).toMatchObject({ passo: 4, rotulo: "Entregue" });
  });

  it("arte esperando aprovação chama atenção", () => {
    expect(situacaoDoPedido({ pedido_status: "convertido", os_status: "aguardando_aprovacao_arte" })).toMatchObject({ tom: "amber" });
  });

  it("fora do caminho não tem passo", () => {
    expect(situacaoDoPedido({ pedido_status: "rejeitado", os_status: null }).passo).toBeNull();
    expect(situacaoDoPedido({ pedido_status: "convertido", os_status: "pausado" })).toMatchObject({ passo: null, tom: "amber" });
  });
});

describe("validade do orçamento", () => {
  it("conta dias corridos a partir do dia da criação", () => {
    const d = validadeDoOrcamento("2026-09-16T15:00:00-03:00", 7);
    expect(d?.toLocaleDateString("pt-BR")).toBe("23/09/2026");
  });
});
