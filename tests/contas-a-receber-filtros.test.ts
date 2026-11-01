import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CHIPS_A_RECEBER,
  FILTRO_A_RECEBER_VAZIO,
  clientesDasContas,
  contarSituacoesAReceber,
  filtrarPorPeriodoBuscaClienteEOrigem,
  filtrarPorSituacaoAReceber,
  origensDasContas,
  situacaoDaContaAReceber,
  totaisAReceber,
  type ContaAReceber,
} from "../src/domain/financeiro/contas-a-receber-filtros";
import { ORIGENS } from "../src/domain/crm/origens";
import { RodapeDeTotais } from "../src/components/financeiro/lista-financeira";

/**
 * Contas a receber no desenho do Holdprint (01/11/2026): busca, situação, período do
 * vencimento, cliente e origem do cliente, com os totais do que está na tela.
 */

const HOJE = "2026-10-31";

const base = { os_titulo: null, parcelas: [] as Array<{ vencimento: string | null }> };
const CONTAS: ContaAReceber[] = [
  { ...base, status: "parcial", cliente_id: "c1", cliente: "Raízes Consultoria", cliente_origem: "Instagram", os_numero: 201, os_titulo: "Banner 3x1", valor_total: 1000, recebido: 400, a_receber: 600, vencido: 200, parcelas: [{ vencimento: "2026-10-10" }, { vencimento: "2026-10-20" }, { vencimento: "2026-11-10" }] },
  { ...base, status: "previsto", cliente_id: "c2", cliente: "Distribuidora Estrela", cliente_origem: "Indicação", os_numero: 202, os_titulo: "Adesivos", valor_total: 500, recebido: 0, a_receber: 500, vencido: 0, parcelas: [{ vencimento: "2026-11-05" }] },
  { ...base, status: "recebido", cliente_id: "c1", cliente: "Raízes Consultoria", cliente_origem: "Instagram", os_numero: 203, os_titulo: "Cartões", valor_total: 300, recebido: 300, a_receber: 0, vencido: 0, parcelas: [{ vencimento: "2026-09-15" }] },
  { ...base, status: "previsto", cliente_id: "c3", cliente: "Clínica Reintegrar", cliente_origem: null, os_numero: 204, valor_total: 99.9, recebido: 0, a_receber: 99.9, vencido: 99.9, parcelas: [{ vencimento: "2026-10-01" }] },
  { ...base, status: "previsto", cliente_id: "c4", cliente: "Cliente de Parceiro", cliente_origem: "convite_parceiro", os_numero: 205, os_titulo: "Placa", valor_total: 10, recebido: 0, a_receber: 10, vencido: 0, parcelas: [{ vencimento: null }] },
];

const os = (lista: ContaAReceber[]) => lista.map((c) => c.os_numero);
const filtro = (parcial: Partial<typeof FILTRO_A_RECEBER_VAZIO>) => ({ ...FILTRO_A_RECEBER_VAZIO, ...parcial });

describe("situação da conta a receber", () => {
  it("vencido manda: vencida; em aberto sem vencido: a vencer; quitada: recebida", () => {
    expect(situacaoDaContaAReceber({ status: "parcial", vencido: 1, a_receber: 5 })).toBe("vencida");
    expect(situacaoDaContaAReceber({ status: "previsto", vencido: 0, a_receber: 5 })).toBe("a_vencer");
    expect(situacaoDaContaAReceber({ status: "recebido", vencido: 0, a_receber: 0 })).toBe("recebida");
  });

  it("conta que ainda não está marcada como recebida nunca vira recebida só por não ter valor em aberto", () => {
    expect(situacaoDaContaAReceber({ status: "previsto", vencido: 0, a_receber: 0 })).toBe("a_vencer");
  });

  it("os chips são Tudo, A vencer, Vencidas e Recebidas", () => {
    expect(CHIPS_A_RECEBER.map((c) => c.rotulo)).toEqual(["Tudo", "A vencer", "Vencidas", "Recebidas"]);
  });
});

describe("filtros", () => {
  it("a lista começa sem recorte nenhum", () => {
    expect(FILTRO_A_RECEBER_VAZIO).toEqual({ situacao: "tudo", periodo: "todos", busca: "", clienteId: "todos", origem: "todas" });
    expect(filtrarPorPeriodoBuscaClienteEOrigem(CONTAS, FILTRO_A_RECEBER_VAZIO, HOJE)).toHaveLength(5);
  });

  it("situação", () => {
    expect(os(filtrarPorSituacaoAReceber(CONTAS, "vencida"))).toEqual([201, 204]);
    expect(os(filtrarPorSituacaoAReceber(CONTAS, "a_vencer"))).toEqual([202, 205]);
    expect(os(filtrarPorSituacaoAReceber(CONTAS, "recebida"))).toEqual([203]);
    expect(filtrarPorSituacaoAReceber(CONTAS, "tudo")).toHaveLength(5);
  });

  it("a contagem de cada chip é a do que ele mostraria", () => {
    expect(contarSituacoesAReceber(CONTAS)).toEqual({ tudo: 5, a_vencer: 2, vencida: 2, recebida: 1 });
  });

  it("período: a conta passa se alguma parcela vence dentro dele; parcela sem data não conta", () => {
    const em = (periodo: "mes" | "proximo_mes" | "mes_passado") =>
      os(filtrarPorPeriodoBuscaClienteEOrigem(CONTAS, filtro({ periodo }), HOJE));
    expect(em("mes")).toEqual([201, 204]);
    expect(em("proximo_mes")).toEqual([201, 202]);
    expect(em("mes_passado")).toEqual([203]);
  });

  it("busca por cliente, título ou número da OS, sem ligar para acento", () => {
    const acha = (busca: string) => os(filtrarPorPeriodoBuscaClienteEOrigem(CONTAS, filtro({ busca }), HOJE));
    expect(acha("raizes")).toEqual([201, 203]);
    expect(acha("clinica")).toEqual([204]);
    expect(acha("banner")).toEqual([201]);
    expect(acha("#202")).toEqual([202]);
    expect(acha("os 205")).toEqual([205]);
    expect(acha("nenhum")).toEqual([]);
  });

  it("cliente", () => {
    expect(os(filtrarPorPeriodoBuscaClienteEOrigem(CONTAS, filtro({ clienteId: "c1" }), HOJE))).toEqual([201, 203]);
  });

  it("origem do cliente: uma, nenhuma ou a que o sistema gravou sozinho", () => {
    const por = (origem: string) => os(filtrarPorPeriodoBuscaClienteEOrigem(CONTAS, filtro({ origem }), HOJE));
    expect(por("Instagram")).toEqual([201, 203]);
    expect(por("sem")).toEqual([204]);
    expect(por("convite_parceiro")).toEqual([205]);
    expect(por("todas")).toHaveLength(5);
  });

  it("os filtros se somam", () => {
    const base2 = filtrarPorPeriodoBuscaClienteEOrigem(CONTAS, filtro({ origem: "Instagram" }), HOJE);
    expect(os(filtrarPorSituacaoAReceber(base2, "vencida"))).toEqual([201]);
  });
});

describe("totais do que está na tela", () => {
  it("a vencer, vencidas e recebidas, em centavos; o total é a soma das três", () => {
    expect(totaisAReceber(CONTAS)).toEqual({
      aVencer: 910,
      vencidas: 299.9,
      pagas: 700,
      total: 1909.9,
      quantidade: 5,
    });
  });

  it("acompanham o filtro", () => {
    const so = filtrarPorSituacaoAReceber(CONTAS, "recebida");
    expect(totaisAReceber(so)).toMatchObject({ aVencer: 0, vencidas: 0, pagas: 300, total: 300, quantidade: 1 });
    expect(totaisAReceber([])).toEqual({ aVencer: 0, vencidas: 0, pagas: 0, total: 0, quantidade: 0 });
  });

  it("valor sujo vale zero, nunca NaN", () => {
    const suja = [{ ...CONTAS[1], a_receber: Number("abc"), vencido: Number("x"), recebido: Number("y") }];
    expect(totaisAReceber(suja)).toMatchObject({ aVencer: 0, vencidas: 0, pagas: 0, total: 0 });
  });
});

describe("opções dos seletores", () => {
  it("clientes sem repetir e em ordem alfabética", () => {
    expect(clientesDasContas(CONTAS).map((c) => c.nome)).toEqual([
      "Cliente de Parceiro",
      "Clínica Reintegrar",
      "Distribuidora Estrela",
      "Raízes Consultoria",
    ]);
  });

  it("origens: a lista de sempre mais a que já está gravada fora dela", () => {
    expect(origensDasContas(CONTAS)).toEqual([...ORIGENS, "convite_parceiro"]);
    expect(origensDasContas([])).toEqual([...ORIGENS]);
  });
});

describe("a tela de Contas a receber usa tudo isso", () => {
  const TELA = readFileSync("src/routes/_authenticated/a-receber.tsx", "utf8");

  it("lista só o que passou pelos filtros e fecha com os totais, com o dinheiro que entrou chamado de Recebidas", () => {
    expect(TELA).toContain("visiveis.map((c) =>");
    expect(TELA).not.toContain("{contas.map((c) =>");
    expect(TELA).toContain('<RodapeDeTotais totais={totaisDaTela} rotuloPagas="Recebidas" />');
    expect(TELA).toContain("useState<FiltroAReceber>(FILTRO_A_RECEBER_VAZIO)");
    expect(TELA).toContain('id="filtro-origem"');
    expect(TELA).toContain('id="filtro-cliente"');
  });

  it("os hooks dos filtros ficam antes do retorno antecipado da tela sem visão financeira", () => {
    const hook = TELA.indexOf("const totaisDaTela = useMemo");
    const retorno = TELA.indexOf("if (!canSeeFinancials) {");
    expect(hook).toBeGreaterThan(-1);
    expect(retorno).toBeGreaterThan(hook);
  });

  it("o chip Recebidas só aparece quando a lista traz as quitadas, e 'Em aberto' o desfaz", () => {
    expect(TELA).toContain('incluirQuitadas || c.id !== "recebida"');
    expect(TELA).toContain('f.situacao === "recebida" ? { ...f, situacao: "tudo" } : f');
  });

  it("o 'hoje' dos atalhos é o do banco, o mesmo que decide o que está vencido", () => {
    expect(TELA).toContain("const hojeDaTela = resumo?.hoje ?? hojeISO();");
  });
});

describe("o rodapé serve às duas listas", () => {
  it("troca o nome da célula do dinheiro que entrou", () => {
    const receber = renderToStaticMarkup(
      createElement(RodapeDeTotais, { totais: { aVencer: 1, vencidas: 2, pagas: 3, total: 6, quantidade: 3 }, rotuloPagas: "Recebidas" }),
    );
    expect(receber).toContain("Recebidas");
    expect(receber).not.toContain(">Pagas<");
    const pagar = renderToStaticMarkup(
      createElement(RodapeDeTotais, { totais: { aVencer: 1, vencidas: 2, pagas: 3, total: 6, quantidade: 3 } }),
    );
    expect(pagar).toContain("Pagas");
  });
});

describe("o banco devolve a origem do cliente", () => {
  const SQL = readFileSync("supabase/migrations/20261101160000_contas_a_receber_com_origem_do_cliente.sql", "utf8");
  const CODIGO = SQL.replace(/^\s*--.*$/gm, "");

  it("acrescenta a origem e mantém permissão, totais e ordem", () => {
    expect(CODIGO).toContain("AS cliente_origem");
    expect(CODIGO).toContain("public.can_see_financials(auth.uid())");
    expect(CODIGO).toContain("42501");
    for (const chave of ["'total_a_receber'", "'total_vencido'", "'total_recebido'", "'contas'", "'hoje'"]) {
      expect(CODIGO, chave).toContain(chave);
    }
    expect(CODIGO).toContain("ORDER BY x.vencimento_mais_antigo NULLS LAST");
    expect(CODIGO).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
  });
});
