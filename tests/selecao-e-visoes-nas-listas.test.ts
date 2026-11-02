import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SELECAO_VAZIA,
  alternar,
  csvDeLinhas,
  dataBr,
  desmarcarVisiveis,
  dosSelecionados,
  estadoDoCabecalho,
  foraDoFiltro,
  marcarTodas,
  nomeDoArquivoCsv,
  podarSelecao,
  protegerCelula,
  resumoDaSelecao,
} from "../src/domain/financeiro/selecao-de-contas";
import {
  LIMITE_DE_VISOES,
  ajustarVisaoAReceber,
  chaveDasVisoes,
  gravarVisoes,
  lerVisoes,
  normalizarVisoes,
  removerVisao,
  salvarVisao,
  validarFiltroAPagar,
  validarFiltroAReceber,
  visaoAtiva,
} from "../src/domain/financeiro/visoes-salvas";
import { FILTRO_VAZIO, totaisDaLista } from "../src/domain/financeiro/lista-de-contas";
import { FILTRO_A_RECEBER_VAZIO } from "../src/domain/financeiro/contas-a-receber-filtros";
import { BarraDaSelecao, BarraDeVisoes, CabecalhoDaSelecao } from "../src/components/financeiro/selecao-de-contas";

/**
 * Seleção e visões nas listas financeiras (02/11/2026): total dos selecionados, resumo para copiar,
 * CSV seguro e filtros guardados. É o "Ações em lote" do Holdprint reduzido ao que não mexe em
 * dinheiro: dar baixa em várias contas de uma vez continua fora até o dono decidir.
 */

const ler = (c: string) => readFileSync(c, "utf8");
const sem = (t: string) => t.replace(/ /g, " ");
const id = (x: { id: string }) => x.id;
const conta = (i: string) => ({ id: i });

describe("seleção por id", () => {
  it("alternar liga e desliga sem mexer no original", () => {
    const a = alternar(SELECAO_VAZIA, "1");
    expect([...a]).toEqual(["1"]);
    expect(SELECAO_VAZIA.size).toBe(0);
    expect(alternar(a, "1").size).toBe(0);
  });

  it("marcar todas leva as que aparecem e mantém as escondidas; desmarcar só tira as que aparecem", () => {
    const antes = new Set(["escondida"]);
    const marcadas = marcarTodas(antes, ["a", "b"]);
    expect([...marcadas].sort()).toEqual(["a", "b", "escondida"]);
    expect([...desmarcarVisiveis(marcadas, ["a", "b"])]).toEqual(["escondida"]);
  });

  it("o estado do cabeçalho segue o que aparece", () => {
    const vis = ["a", "b", "c"];
    expect(estadoDoCabecalho(new Set(), vis)).toBe("nenhuma");
    expect(estadoDoCabecalho(new Set(["a"]), vis)).toBe("algumas");
    expect(estadoDoCabecalho(new Set(["a", "b", "c", "z"]), vis)).toBe("todas");
    expect(estadoDoCabecalho(new Set(["a"]), [])).toBe("nenhuma");
    // Marcada só fora do filtro: do ponto de vista do que aparece, nenhuma.
    expect(estadoDoCabecalho(new Set(["z"]), vis)).toBe("nenhuma");
  });

  it("só conta as contas que ainda existem, avisa as escondidas e poda o que sumiu", () => {
    const todas = [conta("a"), conta("b"), conta("c")];
    const sel = new Set(["a", "c", "velha"]);
    expect(dosSelecionados(todas, sel, id).map(id)).toEqual(["a", "c"]);
    expect(foraDoFiltro(todas, [conta("a")], sel, id)).toBe(1);
    expect([...podarSelecao(sel, todas, id)].sort()).toEqual(["a", "c"]);
  });
});

describe("resumo para copiar", () => {
  const tela = { singular: "conta a pagar", plural: "contas a pagar", rotuloPagas: "Pagas" };

  it("diz quantas, o dinheiro por situação e o total, no singular e no plural", () => {
    const totais = totaisDaLista(
      [
        { vencimento: "2026-10-20", valor: 100.1, status: "pendente" },
        { vencimento: "2026-12-01", valor: 200.2, status: "pendente" },
        { vencimento: "2026-10-01", valor: 50, status: "paga" },
      ],
      "2026-11-02",
    );
    expect(sem(resumoDaSelecao(tela, totais))).toBe(
      "3 contas a pagar selecionadas. A vencer R$ 200,20, vencidas R$ 100,10, pagas R$ 50,00. Total R$ 350,30.",
    );
    const uma = totaisDaLista([{ vencimento: "2026-12-01", valor: 10, status: "pendente" }], "2026-11-02");
    expect(sem(resumoDaSelecao(tela, uma))).toContain("1 conta a pagar selecionada.");
    expect(resumoDaSelecao(tela, totaisDaLista([], "2026-11-02"))).toBe("Nenhuma conta a pagar selecionada.");
  });
});

describe("CSV para o Excel em português", () => {
  it("BOM, ponto e vírgula, vírgula decimal, aspas dobradas e quebra de linha entre aspas", () => {
    const csv = csvDeLinhas(["Descrição", "Valor"], [["Aluguel; da \"plotter\"", 1234.5], ["Linha\nquebrada", 0.1]]);
    expect(csv.startsWith("﻿Descrição;Valor\r\n")).toBe(true);
    expect(csv).toContain('"Aluguel; da ""plotter""";1234,5');
    expect(csv).toContain('"Linha\nquebrada";0,1');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("texto que a planilha leria como fórmula ganha apóstrofo; número e vazio ficam como estão", () => {
    expect(protegerCelula("=SOMA(A1:A9)")).toBe("'=SOMA(A1:A9)");
    expect(protegerCelula("+5596999999999")).toBe("'+5596999999999");
    expect(protegerCelula("-cmd")).toBe("'-cmd");
    expect(protegerCelula("@usuario")).toBe("'@usuario");
    expect(protegerCelula("Papel A4")).toBe("Papel A4");
    const csv = csvDeLinhas(["a", "b", "c", "d"], [["=1+1", -5, null, undefined]]);
    expect(csv).toContain("'=1+1;-5;;");
  });

  it("nome do arquivo sem acento nem espaço, e data em português", () => {
    expect(nomeDoArquivoCsv("Contas a pagar selecionadas", "2026-11-02")).toBe("contas-a-pagar-selecionadas-2026-11-02.csv");
    expect(nomeDoArquivoCsv("???", "2026-11-02")).toBe("lista-2026-11-02.csv");
    expect(dataBr("2026-11-02")).toBe("02/11/2026");
    expect(dataBr("2026-11-02T12:00:00Z")).toBe("02/11/2026");
    expect(dataBr(null)).toBe("");
    expect(dataBr("ontem")).toBe("");
  });
});

describe("visões salvas", () => {
  const UUID = "7f6b165e-edad-4b03-b4f9-15bc14397b34";

  it("a chave é por tela e por e-mail", () => {
    expect(chaveDasVisoes("contas-a-pagar", " Ana@Bex.com ")).toBe("bexprint:visoes:contas-a-pagar:ana@bex.com");
    expect(chaveDasVisoes("contas-a-receber", null)).toBe("bexprint:visoes:contas-a-receber:sem-email");
  });

  it("valida o filtro vindo do armazenamento: o que não bate vira nulo ou volta ao padrão", () => {
    expect(validarFiltroAPagar({ situacao: "vencida", periodo: "mes", busca: "luz" })).toEqual({ situacao: "vencida", periodo: "mes", busca: "luz" });
    expect(validarFiltroAPagar({ situacao: "recebida", periodo: "mes", busca: "" })).toBeNull();
    expect(validarFiltroAPagar({ situacao: "tudo", periodo: "ontem", busca: "" })).toBeNull();
    expect(validarFiltroAPagar("x")).toBeNull();
    expect(validarFiltroAReceber({ situacao: "recebida", periodo: "ano", busca: "", clienteId: UUID, origem: "Instagram" })).toEqual({
      situacao: "recebida", periodo: "ano", busca: "", clienteId: UUID, origem: "Instagram",
    });
    // Cliente que não é id vira "todos"; origem vazia vira "todas".
    expect(validarFiltroAReceber({ situacao: "tudo", periodo: "todos", busca: "", clienteId: "drop table", origem: "" })).toEqual(FILTRO_A_RECEBER_VAZIO);
    expect(validarFiltroAReceber({ situacao: "paga", periodo: "todos", busca: "", clienteId: "todos", origem: "todas" })).toBeNull();
  });

  it("normaliza a lista gravada: descarta lixo, repetido e o que passa do limite", () => {
    const boa = { id: "1", nome: "  Vencidas   do mês ", filtro: { situacao: "vencida", periodo: "mes", busca: "" } };
    const lista = normalizarVisoes([boa, boa, { id: "2", nome: "", filtro: boa.filtro }, { id: "3", nome: "x", filtro: { situacao: "?" } }, null, "lixo"], validarFiltroAPagar);
    expect(lista).toEqual([{ id: "1", nome: "Vencidas do mês", filtro: { situacao: "vencida", periodo: "mes", busca: "" } }]);
    expect(normalizarVisoes({ nao: "lista" }, validarFiltroAPagar)).toEqual([]);
    const muitas = Array.from({ length: LIMITE_DE_VISOES + 5 }, (_, i) => ({ id: `v${i}`, nome: `Visão ${i}`, filtro: boa.filtro }));
    expect(normalizarVisoes(muitas, validarFiltroAPagar)).toHaveLength(LIMITE_DE_VISOES);
  });

  it("lê e grava sem estourar quando o armazenamento recusa ou o JSON está quebrado", () => {
    const dados = new Map<string, string>();
    const arm = { getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => void dados.set(k, v) };
    const f = { situacao: "a_vencer" as const, periodo: "semana" as const, busca: "" };
    const lista = [{ id: "1", nome: "Esta semana", filtro: f }];
    gravarVisoes("k", lista, arm);
    expect(lerVisoes("k", arm, validarFiltroAPagar)).toEqual(lista);
    dados.set("k", "{quebrado");
    expect(lerVisoes("k", arm, validarFiltroAPagar)).toEqual([]);
    expect(lerVisoes("k", null, validarFiltroAPagar)).toEqual([]);
    expect(() => gravarVisoes("k", lista, { setItem: () => { throw new Error("cota"); } })).not.toThrow();
  });

  it("guardar: nome novo entra; nome igual (sem olhar acento nem maiúscula) troca o filtro; vazio e limite recusam", () => {
    const f1 = { situacao: "vencida" as const, periodo: "mes" as const, busca: "" };
    const f2 = { situacao: "paga" as const, periodo: "ano" as const, busca: "" };
    const a = salvarVisao([], "Vencidas do mês", f1, "id1");
    expect(a).toMatchObject({ ok: true });
    if (!a.ok) throw new Error("esperava ok");
    const b = salvarVisao(a.lista, "vencidas do mes", f2, "id2");
    expect(b).toMatchObject({ ok: true });
    if (!b.ok) throw new Error("esperava ok");
    expect(b.lista).toHaveLength(1);
    expect(b.lista[0]).toMatchObject({ id: "id1", filtro: f2, nome: "vencidas do mes" });
    expect(salvarVisao([], "   ", f1, "x")).toEqual({ ok: false, erro: "Dê um nome à visão." });
    const cheia = Array.from({ length: LIMITE_DE_VISOES }, (_, i) => ({ id: `v${i}`, nome: `V${i}`, filtro: f1 }));
    expect(salvarVisao(cheia, "Mais uma", f1, "x")).toMatchObject({ ok: false });
  });

  it("remover tira pelo id e a visão ativa é a de filtro igual ao de agora", () => {
    const f = { situacao: "vencida" as const, periodo: "mes" as const, busca: "" };
    const lista = [{ id: "1", nome: "A", filtro: f }, { id: "2", nome: "B", filtro: FILTRO_VAZIO }];
    expect(removerVisao(lista, "1").map((v) => v.id)).toEqual(["2"]);
    expect(visaoAtiva(lista, { ...f })?.id).toBe("1");
    expect(visaoAtiva(lista, { situacao: "tudo", periodo: "ano", busca: "" })).toBeNull();
  });

  it("aplicar visão de contas a receber com cliente ou origem que sumiram volta ao padrão desses dois", () => {
    const filtro = { situacao: "vencida" as const, periodo: "mes" as const, busca: "lona", clienteId: UUID, origem: "Feira" };
    expect(ajustarVisaoAReceber(filtro, [{ id: UUID }], ["Feira", "Instagram"])).toEqual(filtro);
    expect(ajustarVisaoAReceber(filtro, [], ["Instagram"])).toEqual({ ...filtro, clienteId: "todos", origem: "todas" });
    expect(ajustarVisaoAReceber({ ...filtro, origem: "sem" }, [{ id: UUID }], [])).toMatchObject({ origem: "sem" });
  });
});

describe("as peças na tela", () => {
  const totais = totaisDaLista([{ vencimento: "2026-12-01", valor: 80, status: "pendente" }], "2026-11-02");
  const tela = { singular: "conta a pagar", plural: "contas a pagar" };

  it("a barra mostra a contagem, o total da seleção, as três ações e o aviso das escondidas", () => {
    const h = renderToStaticMarkup(
      createElement(BarraDaSelecao, { totais, tela, rotuloPagas: "Pagas", foraDoFiltro: 2, onCopiar: () => {}, onBaixarCsv: () => {}, onLimpar: () => {} }),
    );
    expect(h.includes("1 conta a pagar selecionada")).toBe(true);
    expect(h.includes("2 fora do filtro de agora")).toBe(true);
    expect(h.includes("Copiar resumo")).toBe(true);
    expect(h.includes("Baixar CSV")).toBe(true);
    expect(h.includes("Limpar seleção")).toBe(true);
    expect(h.includes('aria-label="Totais da seleção"')).toBe(true);
    expect(h.includes('role="status"')).toBe(true);
  });

  it("o cabeçalho marca as que aparecem, anuncia o número e some quando não há nada na tela", () => {
    const h = renderToStaticMarkup(createElement(CabecalhoDaSelecao, { estado: "algumas", aparecem: 7, onAlternar: () => {} }));
    expect(h.includes('aria-label="Selecionar as 7 que aparecem"')).toBe(true);
    expect(h.includes('aria-checked="mixed"') || h.includes('data-state="indeterminate"')).toBe(true);
    expect(renderToStaticMarkup(createElement(CabecalhoDaSelecao, { estado: "nenhuma", aparecem: 0, onAlternar: () => {} }))).toBe("");
  });

  it("as visões: chips com aria-pressed, remover com nome, guardar só com filtro, e nada quando não há o que mostrar", () => {
    const f = { situacao: "vencida", periodo: "mes", busca: "" };
    const comDuas = renderToStaticMarkup(
      createElement(BarraDeVisoes<typeof f>, {
        visoes: [{ id: "1", nome: "Vencidas do mês", filtro: f }, { id: "2", nome: "Pagas", filtro: { ...f, situacao: "paga" } }],
        ativaId: "1",
        podeGuardar: true,
        onAplicar: () => {},
        onGuardar: () => null,
        onRemover: () => {},
      }),
    );
    expect(comDuas.includes('aria-pressed="true"')).toBe(true);
    expect(comDuas.includes('aria-pressed="false"')).toBe(true);
    expect(comDuas.includes('aria-label="Remover a visão Vencidas do mês"')).toBe(true);
    expect(comDuas.includes("Guardar esta visão")).toBe(true);
    const semFiltro = renderToStaticMarkup(
      createElement(BarraDeVisoes<typeof f>, { visoes: [], ativaId: null, podeGuardar: false, onAplicar: () => {}, onGuardar: () => null, onRemover: () => {} }),
    );
    expect(semFiltro).toBe("");
  });
});

describe("as duas telas usam as peças e nada aqui mexe em dinheiro", () => {
  it("contas a pagar e contas a receber ligam seleção, resumo, CSV e visões", () => {
    for (const caminho of ["src/routes/_authenticated/fluxo-caixa.tsx", "src/routes/_authenticated/a-receber.tsx"]) {
      const t = ler(caminho);
      expect(t.includes("useSelecaoDeContas("), caminho).toBe(true);
      expect(t.includes("useVisoesSalvas<"), caminho).toBe(true);
      expect(t.includes("<BarraDaSelecao"), caminho).toBe(true);
      expect(t.includes("<BarraDeVisoes"), caminho).toBe(true);
      expect(t.includes("<CabecalhoDaSelecao"), caminho).toBe(true);
      expect(t.includes("<CaixaDeSelecao"), caminho).toBe(true);
      expect(t.includes("csvDeLinhas("), caminho).toBe(true);
      expect(t.includes("resumoDaSelecao("), caminho).toBe(true);
    }
    expect(ler("src/routes/_authenticated/fluxo-caixa.tsx").includes("rotulo={`Selecionar ${c.descricao}`}")).toBe(true);
    expect(ler("src/routes/_authenticated/a-receber.tsx").includes("selecionada={marcacao.selecao.has(c.conta_id)}")).toBe(true);
  });

  it("as peças e os ganchos não falam com o banco: selecionar, copiar e baixar CSV não gravam nada", () => {
    for (const caminho of [
      "src/components/financeiro/selecao-de-contas.tsx",
      "src/components/financeiro/use-selecao-e-visoes.ts",
      "src/domain/financeiro/selecao-de-contas.ts",
      "src/domain/financeiro/visoes-salvas.ts",
      "src/lib/arquivos-no-navegador.ts",
    ]) {
      const t = ler(caminho);
      expect(/supabase|\.rpc\(|\.mutate\(|fetch\(/.test(t), caminho).toBe(false);
      expect(/\stitle=/.test(t), caminho).toBe(false);
      expect(/(?<![-\w])text-primary(?![-\w])/.test(t), caminho).toBe(false);
    }
  });

  it("caixa de 24 px com alvo de 44 px, e rótulos que o leitor de tela lê", () => {
    const t = ler("src/components/financeiro/selecao-de-contas.tsx");
    expect(t.includes('className="h-6 w-6"')).toBe(true);
    expect(t.includes("h-11 w-11")).toBe(true);
    expect(t.includes("aria-label={rotulo}")).toBe(true);
  });
});
