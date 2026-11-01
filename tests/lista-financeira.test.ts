import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CHIPS_DE_SITUACAO,
  FILTRO_VAZIO,
  contarPorSituacao,
  filtrarPorPeriodoEBusca,
  filtrarPorSituacao,
  periodosDaLista,
  situacaoDaConta,
  totaisDaLista,
  type ContaDaLista,
} from "../src/domain/financeiro/lista-de-contas";
import { AvisoDeFiltro, GrupoDeChips, RodapeDeTotais } from "../src/components/financeiro/lista-financeira";

/**
 * Lista financeira no desenho do Holdprint (31/10/2026), Onda 3 do plano
 * `docs/plano-interface-holdprint-31-10-2026.md`: chips de situação, atalhos de período,
 * busca e rodapé de totais na aba "Contas a pagar" da tela de Caixa.
 */

const HOJE = "2026-10-31"; // sábado

const CONTAS: ContaDaLista[] = [
  { descricao: "Tinta Camaleão", fornecedor: "Camaleão Tintas", categoria: "material", vencimento: "2026-10-20", valor: 100, status: "aberta" },
  { descricao: "Aluguel", fornecedor: null, categoria: "fixa", vencimento: "2026-10-31", valor: "250.50", status: "aberta" },
  { descricao: "Energia", fornecedor: "Equatorial", categoria: "fixa", vencimento: "2026-11-05", valor: 0.1, status: "aberta" },
  { descricao: "Internet", fornecedor: "Gráfica Net", categoria: "fixa", vencimento: "2026-09-10", valor: 0.2, status: "paga" },
  { descricao: "Conta errada", fornecedor: null, categoria: null, vencimento: "2026-10-25", valor: 999, status: "cancelada" },
];

const nomes = (lista: ContaDaLista[]) => lista.map((c) => c.descricao);

describe("situação da conta", () => {
  it("paga e cancelada são o que dizem; aberta vence só no dia seguinte", () => {
    expect(situacaoDaConta({ status: "paga", vencimento: "2020-01-01" }, HOJE)).toBe("paga");
    expect(situacaoDaConta({ status: "cancelada", vencimento: "2020-01-01" }, HOJE)).toBe("cancelada");
    expect(situacaoDaConta({ status: "aberta", vencimento: "2026-10-30" }, HOJE)).toBe("vencida");
    expect(situacaoDaConta({ status: "aberta", vencimento: HOJE }, HOJE)).toBe("a_vencer");
    expect(situacaoDaConta({ status: "aberta", vencimento: "2026-11-01" }, HOJE)).toBe("a_vencer");
  });

  it("status que o banco passe a ter conta como em aberto, como a tela já fazia", () => {
    expect(situacaoDaConta({ status: "parcial", vencimento: "2026-10-01" }, HOJE)).toBe("vencida");
  });
});

describe("atalhos de período", () => {
  const por = (hoje: string) => Object.fromEntries(periodosDaLista(hoje).map((p) => [p.id, [p.de, p.ate]]));

  it("num sábado: semana de segunda a domingo, mês, mês passado, próximo mês e ano", () => {
    const p = por(HOJE);
    expect(p.todos).toEqual([null, null]);
    expect(p.hoje).toEqual([HOJE, HOJE]);
    expect(p.semana).toEqual(["2026-10-26", "2026-11-01"]);
    expect(p.mes).toEqual(["2026-10-01", "2026-10-31"]);
    expect(p.mes_passado).toEqual(["2026-09-01", "2026-09-30"]);
    expect(p.proximo_mes).toEqual(["2026-11-01", "2026-11-30"]);
    expect(p.ano).toEqual(["2026-01-01", "2026-12-31"]);
  });

  it("segunda e domingo ficam na mesma semana", () => {
    expect(por("2026-10-26").semana).toEqual(["2026-10-26", "2026-11-01"]);
    expect(por("2026-11-01").semana).toEqual(["2026-10-26", "2026-11-01"]);
  });

  it("virada de ano e fevereiro bissexto", () => {
    expect(por("2026-01-15").mes_passado).toEqual(["2025-12-01", "2025-12-31"]);
    expect(por("2026-12-10").proximo_mes).toEqual(["2027-01-01", "2027-01-31"]);
    expect(por("2028-03-05").mes_passado).toEqual(["2028-02-01", "2028-02-29"]);
  });

  it("a ordem é a do olhar: do mais curto ao mais largo", () => {
    expect(periodosDaLista(HOJE).map((p) => p.rotulo)).toEqual([
      "Todos",
      "Hoje",
      "Esta semana",
      "Este mês",
      "Mês passado",
      "Próximo mês",
      "Este ano",
    ]);
  });
});

describe("filtros", () => {
  it("a lista começa sem recorte nenhum", () => {
    expect(FILTRO_VAZIO).toEqual({ situacao: "tudo", periodo: "todos", busca: "" });
    expect(filtrarPorPeriodoEBusca(CONTAS, FILTRO_VAZIO, HOJE)).toHaveLength(5);
    expect(filtrarPorSituacao(CONTAS, "tudo", HOJE)).toHaveLength(5);
  });

  it("busca por descrição, fornecedor ou categoria, sem ligar para acento nem maiúscula", () => {
    const acha = (busca: string) => nomes(filtrarPorPeriodoEBusca(CONTAS, { periodo: "todos", busca }, HOJE));
    expect(acha("camaleao")).toEqual(["Tinta Camaleão"]);
    expect(acha("GRAFICA")).toEqual(["Internet"]);
    expect(acha("  fixa ")).toEqual(["Aluguel", "Energia", "Internet"]);
    expect(acha("nada disso")).toEqual([]);
  });

  it("período recorta pelo vencimento, com os dois extremos dentro", () => {
    const em = (periodo: "mes" | "hoje" | "mes_passado") =>
      nomes(filtrarPorPeriodoEBusca(CONTAS, { periodo, busca: "" }, HOJE));
    expect(em("mes")).toEqual(["Tinta Camaleão", "Aluguel", "Conta errada"]);
    expect(em("hoje")).toEqual(["Aluguel"]);
    expect(em("mes_passado")).toEqual(["Internet"]);
  });

  it("chips de situação", () => {
    expect(nomes(filtrarPorSituacao(CONTAS, "vencida", HOJE))).toEqual(["Tinta Camaleão"]);
    expect(nomes(filtrarPorSituacao(CONTAS, "a_vencer", HOJE))).toEqual(["Aluguel", "Energia"]);
    expect(nomes(filtrarPorSituacao(CONTAS, "paga", HOJE))).toEqual(["Internet"]);
    expect(CHIPS_DE_SITUACAO.map((c) => c.rotulo)).toEqual(["Tudo", "A vencer", "Vencidas", "Pagas"]);
  });

  it("a contagem de cada chip é a do que ele mostraria; cancelada só aparece em Tudo", () => {
    expect(contarPorSituacao(CONTAS, HOJE)).toEqual({ tudo: 5, a_vencer: 2, vencida: 1, paga: 1 });
  });
});

describe("totais", () => {
  it("separam a vencer, vencidas e pagas; cancelada não é dinheiro", () => {
    expect(totaisDaLista(CONTAS, HOJE)).toEqual({
      aVencer: 250.6,
      vencidas: 100,
      pagas: 0.2,
      total: 350.8,
      quantidade: 5,
    });
  });

  it("soma em centavos: 0,10 mais 0,20 é 0,30 e não 0,30000000000000004", () => {
    const duas: ContaDaLista[] = [
      { vencimento: "2026-10-01", valor: 0.1, status: "paga" },
      { vencimento: "2026-10-02", valor: 0.2, status: "paga" },
    ];
    expect(totaisDaLista(duas, HOJE).pagas).toBe(0.3);
  });

  it("valor nulo, vazio ou lixo vale zero, nunca NaN", () => {
    const sujas: ContaDaLista[] = [
      { vencimento: "2026-12-01", valor: null, status: "aberta" },
      { vencimento: "2026-12-01", valor: "abc", status: "aberta" },
      { vencimento: "2026-12-01", valor: "12.30", status: "aberta" },
    ];
    expect(totaisDaLista(sujas, HOJE)).toMatchObject({ aVencer: 12.3, total: 12.3, quantidade: 3 });
    expect(totaisDaLista([], HOJE)).toEqual({ aVencer: 0, vencidas: 0, pagas: 0, total: 0, quantidade: 0 });
  });
});

describe("peças na tela", () => {
  const sem = (html: string) => html.replace(/ /g, " ");

  it("o grupo de chips é um grupo de opções e marca só a escolhida", () => {
    const html = renderToStaticMarkup(
      createElement(GrupoDeChips, {
        rotulo: "Situação",
        opcoes: [
          { id: "a", rotulo: "Tudo", quantidade: 5 },
          { id: "b", rotulo: "Pagas" },
        ],
        valor: "a",
        onChange: () => {},
      }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Situação"');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html.match(/aria-checked="false"/g)).toHaveLength(1);
    expect(html).toContain("bg-primary text-primary-foreground");
    expect(html).toContain(">5<");
  });

  it("o rodapé mostra os quatro totais em reais, com o nome escrito", () => {
    const html = sem(
      renderToStaticMarkup(
        createElement(RodapeDeTotais, {
          totais: { aVencer: 1234.5, vencidas: 100, pagas: 0.2, total: 1334.7, quantidade: 4 },
        }),
      ),
    );
    for (const nome of ["A vencer", "Vencidas", "Pagas", "Total"]) expect(html).toContain(nome);
    expect(html).toContain("R$ 1.234,50");
    expect(html).toContain("R$ 1.334,70");
    expect(html).toContain('aria-label="Totais da lista"');
  });

  it("o aviso diz quanto está sendo mostrado e dá o caminho de volta", () => {
    const html = renderToStaticMarkup(createElement(AvisoDeFiltro, { mostrando: 3, total: 12, onLimpar: () => {} }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Mostrando");
    expect(html).toContain("Limpar filtros");
  });
});

describe("a tela de Caixa usa a lista filtrada", () => {
  const TELA = readFileSync("src/routes/_authenticated/fluxo-caixa.tsx", "utf8");

  it("lista só o que passou pelos filtros e fecha com os totais", () => {
    expect(TELA).toContain("visiveis.map((c)");
    expect(TELA).not.toContain("contas.map((c)");
    expect(TELA).toContain("<RodapeDeTotais totais={totaisDaTela} />");
    expect(TELA).toContain("useState<FiltroDaLista>(FILTRO_VAZIO)");
  });

  it("o 'hoje' do filtro é o da casa, não o do aparelho", () => {
    expect(TELA).toContain("const hojeDaLista = hoje();");
    expect(TELA).toContain("const hoje = () => hojeBr();");
  });
});
