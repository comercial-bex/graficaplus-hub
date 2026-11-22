import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calcularPainel,
  chaveDoDia,
  dataCompleta,
  diaDoAviso,
  diaMes,
  diasAte,
  ERRO_DO_PAINEL,
  filtrarParceiros,
  frasePrazo,
  lerPainel,
  montarLivro,
  queOLancamentoPaga,
  reais,
  rotuloDoTipo,
  type Lancamento,
  type ParceiroComCredito,
  type ProgramaDeCredito,
} from "@/domain/parceiros/creditos-painel";

/**
 * A tela de créditos dos parceiros (22/11/2026). Os números do primeiro bloco são os do banco vivo: 15 parceiros com um
 * crédito de entrada de R$ 50,00, 14 vencendo em 14/12 e 1 em 15/12, nenhum usado.
 */

const AGORA = new Date("2026-11-22T21:22:00Z"); // 18:22 em Macapá
const PROGRAMA: ProgramaDeCredito = { entradaAtiva: true, entradaValor: 50, validadeDias: 30, pedidoMinimo: 150, maxPct: 50, lembreteAtivo: true, lembreteDias: 7 };

let seq = 0;
const lan = (o: Partial<Lancamento> & { tipo: string; valor: number; criadoEm: string }): Lancamento => ({
  id: `l${++seq}`,
  criadoEm: new Date(o.criadoEm),
  tipo: o.tipo,
  valor: o.valor,
  descricao: o.descricao ?? null,
  expiraEm: o.expiraEm ? new Date(o.expiraEm as unknown as string) : null,
  osId: o.osId ?? null,
  osNumero: o.osNumero ?? null,
  orcamentoId: o.orcamentoId ?? null,
  orcamentoNumero: o.orcamentoNumero ?? null,
  pedidoTotal: o.pedidoTotal ?? null,
  criadoPorNome: o.criadoPorNome ?? null,
});
const entrada = (criadoEm = "2026-11-14T16:25:37Z", expira = "2026-12-14T16:25:37Z") => ({ tipo: "entrada", valor: 50, criadoEm, expiraEm: expira as unknown as Date, descricao: "Crédito de entrada: vale na 1ª compra" });
const parceiro = (nome: string, lancamentos: Lancamento[], saldo: number, extra: Partial<ParceiroComCredito> = {}): ParceiroComCredito => ({
  parceiroId: `p-${nome}`, nome, status: "ativo", responsavelNome: "Maiara Brito", saldo, lancamentos, ...extra,
});

describe("o painel que o banco entrega", () => {
  const bruto = {
    agora: "2026-11-22T21:22:00Z",
    programa: { entrada_ativa: true, entrada_valor: 50, validade_dias: 30, pedido_minimo: 150, max_pct: 50, lembrete_ativo: true, lembrete_dias: 7 },
    parceiros: [
      { parceiro_id: "a", nome: "Aline", status: "ativo", responsavel_nome: "Jhesselem Medeiros", saldo: "50.00",
        lancamentos: [{ id: "x1", criado_em: "2026-11-14T16:25:37+00:00", tipo: "entrada", valor: "50.00", descricao: "Crédito de entrada: vale na 1ª compra",
          expira_em: "2026-12-14T16:25:37+00:00", os_id: null, os_numero: null, orcamento_id: null, orcamento_numero: null, pedido_total: null, criado_por_nome: null }] },
      { parceiro_id: "b", nome: " ", saldo: null, lancamentos: [{ id: "sem-valor", criado_em: "2026-11-14T16:25:37+00:00", tipo: "entrada" }, "lixo", { criado_em: "x" }] },
      "não é objeto",
    ],
  };

  it("lê números em texto, datas e descarta linha sem id, sem valor ou sem data", () => {
    const p = lerPainel(bruto);
    expect(p.agora.toISOString()).toBe("2026-11-22T21:22:00.000Z");
    expect(p.programa).toEqual({ entradaAtiva: true, entradaValor: 50, validadeDias: 30, pedidoMinimo: 150, maxPct: 50, lembreteAtivo: true, lembreteDias: 7 });
    expect(p.parceiros).toHaveLength(2);
    expect(p.parceiros[0]).toMatchObject({ nome: "Aline", saldo: 50, responsavelNome: "Jhesselem Medeiros" });
    expect(p.parceiros[0].lancamentos[0]).toMatchObject({ valor: 50, tipo: "entrada" });
    expect(p.parceiros[0].lancamentos[0].expiraEm?.toISOString()).toBe("2026-12-14T16:25:37.000Z");
    expect(p.parceiros[1].lancamentos).toEqual([]);
    expect(p.parceiros[1].saldo).toBe(0);
  });

  it("resposta fora do formato é erro, nunca 'tudo zerado'", () => {
    for (const ruim of [null, undefined, "x", 3, [], {}, { parceiros: "não" }]) {
      expect(() => lerPainel(ruim)).toThrow(ERRO_DO_PAINEL);
    }
    expect(lerPainel({ parceiros: [] }).programa).toBeNull();
  });
});

describe("os 15 créditos de entrada do banco vivo", () => {
  const nomes = Array.from({ length: 15 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`);
  const parceiros = nomes.map((n, i) => parceiro(n, [lan(entrada("2026-11-14T16:25:37Z", i === 0 ? "2026-12-15T16:25:37Z" : "2026-12-14T16:25:37Z"))], 50));
  const { resumo, parceiros: calc } = calcularPainel({ agora: AGORA, programa: PROGRAMA, parceiros });

  it("o resumo bate com o banco: R$ 750,00, 15 com saldo, nada usado, nada vencido", () => {
    expect(resumo).toMatchObject({ saldoTotal: 750, parceirosComSaldo: 15, concedido: 750, usado: 0, vencidoSemUso: 0, pedidosPagos: 0, divergentes: [], semCredito: 0 });
  });

  it("o que vence: 14/12 com R$ 700,00 de 14 parceiros (em 22 dias) e 15/12 com R$ 50,00 de 1", () => {
    expect(resumo.vencimentos.map((v) => ({ dia: v.dia, dias: v.dias, valor: v.valor, parceiros: v.parceiros }))).toEqual([
      { dia: "14/12", dias: 22, valor: 700, parceiros: 14 },
      { dia: "15/12", dias: 23, valor: 50, parceiros: 1 },
    ]);
    expect(resumo.vencimentos[0].nomes).toHaveLength(14);
  });

  it("cada parceiro: situação 'a vencer', 22 dias, vive R$ 50,00 e confere com o banco", () => {
    const p = calc[1];
    expect(p.livro.linhas[0]).toMatchObject({ natureza: "credito", situacao: "a_vencer", dias: 22, restante: 50, usado: 0 });
    expect(p).toMatchObject({ diasParaVencer: 22, valorQueVence: 50, confere: true });
  });

  it("o que o crédito de entrada paga: a regra do programa, enquanto não houve uso", () => {
    expect(queOLancamentoPaga(calc[1].livro.linhas[0], PROGRAMA)).toBe("Ainda sem uso. Vale na 1ª compra, até 50% de um pedido de no mínimo R$ 150,00.");
    expect(queOLancamentoPaga(calc[1].livro.linhas[0], null)).toBe("Ainda sem uso.");
  });
});

describe("o que cada lançamento pagou", () => {
  const calc = (lancamentos: Lancamento[], saldo: number) => calcularPainel({ agora: AGORA, programa: PROGRAMA, parceiros: [parceiro("X", lancamentos, saldo)] }).parceiros[0];

  it("um uso paga parte do crédito: o crédito diz o pedido, o resto continua valendo", () => {
    const p = calc([lan(entrada()), lan({ tipo: "uso", valor: -30, criadoEm: "2026-11-18T12:00:00Z", orcamentoId: "o7", orcamentoNumero: "7", pedidoTotal: 150, descricao: "Reservado para o pedido nº 7" })], 20);
    const credito = p.livro.linhas.find((l) => l.natureza === "credito")!;
    expect(credito.pagou).toEqual([{ rotulo: "pedido nº 7", valor: 30, pedidoTotal: 150, tipo: "uso" }]);
    expect(credito).toMatchObject({ usado: 30, restante: 20, situacao: "em_uso" });
    expect(queOLancamentoPaga(credito, PROGRAMA)).toBe("Pagou R$ 30,00 do pedido nº 7 (total R$ 150,00). Ainda resta R$ 20,00.");
    const uso = p.livro.linhas.find((l) => l.natureza === "uso")!;
    expect(queOLancamentoPaga(uso, PROGRAMA)).toBe("Pagou parte do pedido nº 7 (total R$ 150,00).");
    expect(p).toMatchObject({ confere: true });
    expect(p.livro).toMatchObject({ concedido: 50, usado: 30, usadoEmPedidos: 30, vivo: 20, vencidoSemUso: 0 });
  });

  it("o crédito que vence primeiro paga primeiro", () => {
    const p = calc(
      [
        lan(entrada("2026-11-14T10:00:00Z", "2026-12-14T10:00:00Z")),
        lan({ tipo: "indicacao", valor: 20, criadoEm: "2026-11-15T10:00:00Z", expiraEm: "2026-12-10T10:00:00Z" as unknown as Date }),
        lan({ tipo: "uso", valor: -40, criadoEm: "2026-11-20T10:00:00Z", orcamentoNumero: "9", orcamentoId: "o9" }),
      ],
      30,
    );
    const creditos = p.livro.linhas.filter((l) => l.natureza === "credito");
    expect(creditos.find((c) => c.lancamento.tipo === "indicacao")).toMatchObject({ usado: 20, restante: 0, situacao: "usado" });
    expect(creditos.find((c) => c.lancamento.tipo === "entrada")).toMatchObject({ usado: 20, restante: 30 });
    expect(p.confere).toBe(true);
  });

  it("um uso depois do vencimento de um crédito não sai dele", () => {
    const p = calc(
      [
        lan({ tipo: "boas_vindas", valor: 50, criadoEm: "2026-10-01T10:00:00Z", expiraEm: "2026-11-01T10:00:00Z" as unknown as Date }),
        lan({ tipo: "uso", valor: -20, criadoEm: "2026-11-15T10:00:00Z", orcamentoNumero: "3", orcamentoId: "o3" }),
      ],
      0,
    );
    expect(p.livro.semCredito).toBe(20);
    const velho = p.livro.linhas.find((l) => l.natureza === "credito")!;
    expect(velho).toMatchObject({ situacao: "vencido", usado: 0, restante: 50 });
    expect(queOLancamentoPaga(velho, PROGRAMA)).toBe("Venceu sem pagar nenhum pedido.");
    expect(p.livro.vencidoSemUso).toBe(50);
    expect(queOLancamentoPaga(p.livro.linhas.find((l) => l.natureza === "uso")!, PROGRAMA)).toContain("Atenção: R$ 20,00 não têm crédito que cubra.");
  });

  it("devolução do uso do mesmo pedido desfaz o uso: o crédito volta inteiro", () => {
    const p = calc(
      [
        lan(entrada()),
        lan({ tipo: "uso", valor: -30, criadoEm: "2026-11-18T12:00:00Z", orcamentoId: "o7", orcamentoNumero: "7" }),
        lan({ tipo: "estorno_uso", valor: 30, criadoEm: "2026-11-19T12:00:00Z", orcamentoId: "o7", orcamentoNumero: "7" }),
      ],
      50,
    );
    expect(p.livro.linhas.find((l) => l.natureza === "credito")).toMatchObject({ usado: 0, restante: 50, situacao: "a_vencer" });
    const uso = p.livro.linhas.find((l) => l.natureza === "uso")!;
    expect(queOLancamentoPaga(uso, PROGRAMA)).toContain("Devolvido: o pedido nº 7 não seguiu");
    expect(queOLancamentoPaga(p.livro.linhas.find((l) => l.natureza === "devolucao")!, PROGRAMA)).toBe("Devolveu o uso do pedido nº 7.");
    expect(p.confere).toBe(true);
  });

  it("devolução sem uso correspondente vale como crédito", () => {
    const p = calc([lan({ tipo: "estorno_uso", valor: 15, criadoEm: "2026-11-19T12:00:00Z", orcamentoId: "x" })], 15);
    expect(p.livro.linhas[0].natureza).toBe("credito");
    expect(p.livro.vivo).toBe(15);
  });

  it("a baixa de 'venceu sem uso' é só a baixa: não paga pedido nenhum", () => {
    const p = calc(
      [
        lan({ tipo: "boas_vindas", valor: 50, criadoEm: "2026-10-01T10:00:00Z", expiraEm: "2026-11-01T10:00:00Z" as unknown as Date }),
        lan({ tipo: "expirado", valor: -50, criadoEm: "2026-11-02T10:00:00Z" }),
      ],
      0,
    );
    expect(p.livro.linhas.find((l) => l.natureza === "vencimento")).toBeDefined();
    expect(queOLancamentoPaga(p.livro.linhas.find((l) => l.natureza === "vencimento")!, PROGRAMA)).toBe("Baixa de crédito que venceu sem uso.");
    expect(p.livro).toMatchObject({ usado: 0, vencidoSemUso: 50, semCredito: 0 });
  });

  it("ajuste da gerência abate do crédito do que vence primeiro (o motivo fica na linha do lançamento)", () => {
    const p = calc([lan(entrada()), lan({ tipo: "ajuste", valor: -10, criadoEm: "2026-11-16T10:00:00Z", descricao: "Lançado em duplicidade" })], 40);
    const ajuste = p.livro.linhas.find((l) => l.natureza === "ajuste")!;
    expect(queOLancamentoPaga(ajuste, PROGRAMA)).toBe("Baixa manual da gerência: saiu do crédito que vence primeiro.");
    expect(ajuste.lancamento.descricao).toBe("Lançado em duplicidade");
    const credito = p.livro.linhas.find((l) => l.natureza === "credito")!;
    expect(credito).toMatchObject({ usado: 10, restante: 40 });
    expect(queOLancamentoPaga(credito, PROGRAMA)).toBe("Teve R$ 10,00 baixados por ajuste da gerência. Ainda resta R$ 40,00.");
    // Ajuste não é pedido pago: o total de "já pagou pedidos" e o filtro "já usaram" não o contam.
    expect(p.livro).toMatchObject({ usado: 10, usadoEmPedidos: 0 });
    const { resumo } = calcularPainel({ agora: AGORA, programa: PROGRAMA, parceiros: [p] });
    expect(resumo).toMatchObject({ usado: 0, pedidosPagos: 0 });
  });

  it("um uso e um ajuste no mesmo crédito: o texto diz os dois, e só o uso conta como pedido pago", () => {
    const p = calc(
      [
        lan(entrada()),
        lan({ tipo: "uso", valor: -30, criadoEm: "2026-11-18T12:00:00Z", orcamentoId: "o7", orcamentoNumero: "7", pedidoTotal: 150 }),
        lan({ tipo: "ajuste", valor: -10, criadoEm: "2026-11-19T12:00:00Z", descricao: "duplicidade" }),
      ],
      10,
    );
    const credito = p.livro.linhas.find((l) => l.natureza === "credito")!;
    expect(queOLancamentoPaga(credito, PROGRAMA)).toBe("Pagou R$ 30,00 do pedido nº 7 (total R$ 150,00) e teve R$ 10,00 baixados por ajuste da gerência. Ainda resta R$ 10,00.");
    expect(p.livro).toMatchObject({ usado: 40, usadoEmPedidos: 30 });
  });

  it("uso ligado à OS, sem pedido, diz 'OS nº'", () => {
    const p = calc([lan(entrada()), lan({ tipo: "uso", valor: -25, criadoEm: "2026-11-18T12:00:00Z", osId: "os1", osNumero: "212" })], 25);
    expect(p.livro.linhas.find((l) => l.natureza === "credito")!.pagou[0].rotulo).toBe("OS nº 212");
  });

  it("o saldo do banco que não bate com o livro é apontado, e vale o do banco", () => {
    const { parceiros, resumo } = calcularPainel({ agora: AGORA, programa: PROGRAMA, parceiros: [parceiro("Torto", [lan(entrada())], 30)] });
    expect(parceiros[0].confere).toBe(false);
    expect(resumo.divergentes).toEqual(["Torto"]);
    expect(resumo.saldoTotal).toBe(30);
  });

  it("crédito sem vencimento não entra na lista de vencimentos", () => {
    const { resumo, parceiros } = calcularPainel({ agora: AGORA, programa: PROGRAMA, parceiros: [parceiro("Fixo", [lan({ tipo: "cashback", valor: 12, criadoEm: "2026-11-10T10:00:00Z" })], 12)] });
    expect(parceiros[0].livro.linhas[0]).toMatchObject({ situacao: "sem_vencimento", dias: null });
    expect(parceiros[0]).toMatchObject({ venceEm: null, diasParaVencer: null, confere: true });
    expect(resumo.vencimentos).toEqual([]);
  });
});

describe("datas e valores", () => {
  it("o dia é o de Macapá, não o UTC", () => {
    expect(chaveDoDia(new Date("2026-12-14T02:00:00Z"))).toBe("2026-12-13");
    expect(chaveDoDia(new Date("2026-12-14T03:00:00Z"))).toBe("2026-12-14");
    expect(diaMes(new Date("2026-12-14T16:25:37Z"))).toBe("14/12");
    expect(dataCompleta(new Date("2026-12-14T16:25:37Z"))).toBe("14/12/2026");
  });
  it("dias de calendário até o vencimento", () => {
    expect(diasAte(new Date("2026-12-14T16:25:37Z"), AGORA)).toBe(22);
    expect(diasAte(new Date("2026-11-22T23:59:00Z"), AGORA)).toBe(0);
    expect(diasAte(new Date("2026-11-20T12:00:00Z"), AGORA)).toBe(-2);
  });
  it("as frases de prazo", () => {
    expect(frasePrazo(0)).toBe("vence hoje");
    expect(frasePrazo(1)).toBe("vence amanhã");
    expect(frasePrazo(22)).toBe("vence em 22 dias");
    expect(frasePrazo(-1)).toBe("venceu ontem");
    expect(frasePrazo(-5)).toBe("venceu há 5 dias");
  });
  it("o aviso aos responsáveis começa 7 dias antes", () => {
    expect(diaDoAviso("2026-12-14", 7)).toBe("07/12");
    expect(diaDoAviso("2026-12-15", 7)).toBe("08/12");
  });
  it("reais com milhar e vírgula", () => {
    expect(reais(750)).toBe("R$ 750,00");
    expect(reais(1234.5)).toBe("R$ 1.234,50");
    expect(reais(0)).toBe("R$ 0,00");
  });
  it("os rótulos dos tipos", () => {
    expect(rotuloDoTipo("entrada")).toBe("Crédito de entrada");
    expect(rotuloDoTipo("uso")).toBe("Usado em pedido");
    expect(rotuloDoTipo("tipo_novo")).toBe("tipo_novo");
  });
});

describe("filtros e ordem da lista", () => {
  const mk = (nome: string, resp: string, lancs: Lancamento[], saldo: number) => parceiro(nome, lancs, saldo, { responsavelNome: resp });
  const painel = calcularPainel({
    agora: AGORA,
    programa: PROGRAMA,
    parceiros: [
      mk("Ári Castro", "Maiara Brito", [lan(entrada("2026-11-14T10:00:00Z", "2026-12-14T10:00:00Z"))], 50),
      mk("Black", "Jhesselem Medeiros", [lan(entrada("2026-11-14T10:00:00Z", "2026-11-26T10:00:00Z"))], 50),
      mk("Usou", "Maiara Brito", [lan(entrada("2026-11-14T10:00:00Z", "2026-12-14T10:00:00Z")), lan({ tipo: "uso", valor: -50, criadoEm: "2026-11-18T10:00:00Z", orcamentoNumero: "1", orcamentoId: "o1" })], 0),
      mk("Velho", "Jhesselem Medeiros", [lan({ tipo: "boas_vindas", valor: 20, criadoEm: "2026-10-01T10:00:00Z", expiraEm: "2026-11-01T10:00:00Z" as unknown as Date })], 0),
    ],
  }).parceiros;
  const f = (o: Partial<Parameters<typeof filtrarParceiros>[1]>) => filtrarParceiros(painel, { busca: "", responsavel: "", mostrar: "todos", ordem: "nome", ...o }).map((p) => p.nome);

  it("busca sem ligar para acento e caixa, no nome ou no responsável", () => {
    expect(f({ busca: "ari" })).toEqual(["Ári Castro"]);
    expect(f({ busca: "JHESS" })).toEqual(["Black", "Velho"]);
  });
  it("filtra por responsável", () => {
    expect(f({ responsavel: "Maiara Brito" })).toEqual(["Ári Castro", "Usou"]);
  });
  it("mostra só quem tem saldo, quem vence em até 7 dias, quem já usou e quem tem crédito vencido", () => {
    expect(f({ mostrar: "com_saldo" })).toEqual(["Ári Castro", "Black"]);
    expect(f({ mostrar: "vence_logo" })).toEqual(["Black"]);
    expect(f({ mostrar: "usaram" })).toEqual(["Usou"]);
    expect(f({ mostrar: "vencidos" })).toEqual(["Velho"]);
  });
  it("ordena por vencimento (quem não tem vencimento vai por último), por saldo ou por nome", () => {
    expect(f({ ordem: "vence" })).toEqual(["Black", "Ári Castro", "Usou", "Velho"].filter((n) => n !== "Usou" && n !== "Velho").concat(["Usou", "Velho"]));
    expect(f({ ordem: "saldo" }).slice(0, 2)).toEqual(["Ári Castro", "Black"]);
    expect(f({ ordem: "nome" })).toEqual(["Ári Castro", "Black", "Usou", "Velho"]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// A migração e a tela
// ---------------------------------------------------------------------------------------------------------

const ler = (c: string) => readFileSync(c, "utf8");
const semComentarios = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
const MIGRACAO = ler("supabase/migrations/20261122700000_parceiros_creditos_painel.sql");
const PARCEIROS_SEM_CONTATO = ler("supabase/migrations/20261119120000_parceiro_fechado_sem_contato.sql");
const ROTA = ler("src/routes/_authenticated/parceiros-creditos.tsx");
const PECAS = ler("src/components/parceiros/creditos-dos-parceiros.tsx");
const API = ler("src/lib/parceiro-creditos-api.ts");

describe("a função parceiros_creditos_painel", () => {
  const corpo = semComentarios(MIGRACAO);
  const papeis = (verbo: "GRANT" | "REVOKE") =>
    [...corpo.matchAll(new RegExp(`${verbo}\\s+[^;]*?\\s${verbo === "GRANT" ? "TO" : "FROM"}\\s+([^;]+);`, "gi"))].flatMap((m) => m[1].split(",").map((x) => x.trim().toLowerCase()));

  it("só lê, é STABLE, SECURITY DEFINER com o caminho de busca fixo", () => {
    expect(corpo).toMatch(/RETURNS jsonb\s+LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER\s+SET search_path TO 'public'/);
    expect(corpo).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE)\b/i);
    expect([...corpo.matchAll(/CREATE OR REPLACE FUNCTION\s+([\w.]+)/gi)].map((m) => m[1])).toEqual(["public.parceiros_creditos_painel"]);
  });

  it("confere parceiros.read por dentro e nasce FECHADA para anon e public", () => {
    expect(corpo).toMatch(/PERFORM public\.require_permission\('parceiros\.read'\);/);
    expect(papeis("REVOKE")).toEqual(expect.arrayContaining(["public", "anon", "authenticated"]));
    expect(papeis("GRANT")).toEqual(["authenticated"]);
    expect(corpo).toMatch(/has_function_privilege\('anon', v_oid, 'EXECUTE'\)/);
  });

  it("o saldo é EXATAMENTE a conta do cartão e do aviso (_parceiros_sem_contato)", () => {
    const formula = (sql: string) => (semComentarios(sql).match(/greatest\(coalesce\(sum\(pc\.valor\)[\s\S]*?AS disponivel/i)?.[0] ?? "").replace(/\s+/g, "").toLowerCase();
    expect(formula(MIGRACAO).length).toBeGreaterThan(100);
    expect(formula(MIGRACAO)).toBe(formula(PARCEIROS_SEM_CONTATO));
  });

  it("deixa a conta de teste de fora, limita o livro e liga o pedido e a OS", () => {
    expect(corpo).toMatch(/NOT COALESCE\(p\.e_teste, false\)/);
    expect(corpo).toMatch(/LIMIT 100/);
    expect(corpo).toMatch(/LEFT JOIN public\.ordens_servico os ON os\.id = r\.os_id/);
    expect(corpo).toMatch(/LEFT JOIN public\.parceiro_orcamentos po ON po\.id = r\.parceiro_orcamento_id/);
    expect(corpo).toMatch(/EXISTS \(SELECT 1 FROM public\.parceiro_creditos z WHERE z\.parceiro_id = p\.id\)/);
  });

  it("tem o DESFAZER", () => {
    expect(MIGRACAO).toMatch(/-- DROP FUNCTION public\.parceiros_creditos_painel\(\);/);
  });
});

describe("a tela /parceiros-creditos", () => {
  it("lê só pela função da API, sem consulta direta ao banco, e a API usa o nome literal da RPC", () => {
    expect(ROTA).toContain("painelDeCreditos");
    expect(`${ROTA}${PECAS}`).not.toMatch(/supabase\b|\.from\(/);
    expect(API).toMatch(/\(supabase\.rpc as any\)\("parceiros_creditos_painel"\)/);
    expect(API).toMatch(/if \(ehFuncaoAusente\(error\)\) return null;/);
  });

  it("tem todos os estados: carregando, erro com nova tentativa, função ausente, vazio e divergência", () => {
    for (const id of ["creditos-falhou", "creditos-nao-ativada", "sem-creditos", "aviso-divergencia"]) expect(ROTA, id).toContain(`data-testid="${id}"`);
    expect(ROTA).toContain("<Carregando />");
    expect(ROTA).toContain("Tentar de novo");
  });

  it("mostra o resumo, o que vence e o livro de cada parceiro com 'o que paga'", () => {
    expect(PECAS).toContain('data-testid="resumo-dos-creditos"');
    expect(PECAS).toContain('data-testid="vencimentos-dos-creditos"');
    expect(PECAS).toContain('data-testid="o-que-paga"');
    expect(PECAS).toContain("queOLancamentoPaga(l, programa)");
    expect(PECAS).toContain("aria-expanded={aberto}");
  });

  it("não fala de custo, margem nem preço de produto", () => {
    expect(`${ROTA}${PECAS}`.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/custo|margem|multiplicador/i);
  });

  it("está no menu como aba de Parceiros, com a permissão de Parceiros e com dica", () => {
    expect(ler("src/lib/menu.ts")).toContain('aba("Créditos", "/parceiros-creditos")');
    expect(ler("src/lib/permissions.ts")).toContain('{ path: "/parceiros-creditos", permissions: ["parceiros.read"] }');
    expect(ler("src/lib/dicas.ts")).toContain('"/parceiros-creditos": {');
    expect(ler("src/routeTree.gen.ts")).toContain("'/_authenticated/parceiros-creditos'");
  });

  it("sem `title=`, sem `text-primary`", () => {
    for (const f of [ROTA, PECAS]) {
      // `title` do <SectionHeader> é a propriedade do título da tela, não o atributo de dica do navegador.
      expect(f.replace(/<SectionHeader[\s\S]*?\/>/g, "")).not.toMatch(/\stitle=/);
      expect(f).not.toMatch(/text-primary/);
    }
  });
});

describe("a tela Vendas diretas pede só colunas que existem", () => {
  const VENDAS = ler("src/routes/_authenticated/vendas-diretas.tsx");
  it("`parceiros` não tem coluna `nome`: a consulta usa a marca ou o nome do cliente", () => {
    expect(VENDAS).not.toMatch(/parceiros\(nome\)/);
    expect(VENDAS).toContain("parceiro:parceiros(marca_nome, cliente:clientes(nome))");
    expect(VENDAS).toMatch(/l\.parceiro\?\.marca_nome\?\.trim\(\) \|\| l\.parceiro\?\.cliente\?\.nome/);
  });
});
