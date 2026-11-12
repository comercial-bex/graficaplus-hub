import { describe, expect, it } from "vitest";
import {
  agruparNaAbertura,
  configDaCobranca,
  corteDaCobranca,
  decidirCobranca,
  dentroDoHorarioUtil,
  horarioDaCobranca,
  horarioPorExtenso,
  horasUteis,
  inicioDoPedido,
  linkDaConversa,
  minutosEmHoras,
  minutosUteisEntre,
  nomeSemTelefone,
  numeroParaMencao,
  quemCitar,
  textoDaCobranca,
  type Citado,
  type ConfigCobranca,
  type DecisaoDeCobrar,
  type HorarioUtil,
  type ItemDeCobranca,
  type LinhaDaConfiguracao,
  type OrcamentoLigado,
  type Pendencia,
  type PessoaDaEquipe,
} from "@/domain/whatsapp/cobranca";
import { renderizarTemplate } from "@/domain/whatsapp/zapi-envio";

/**
 * REGRA da cobrança de orçamento no grupo (src/domain/whatsapp/cobranca.ts). Node, data fixa,
 * nunca "hoje". Semana de referência: segunda 09/11/2026 a domingo 15/11/2026, hora de Macapá
 * (UTC−3, sem horário de verão). Todos os dados são inventados.
 */

/** Hora de Macapá escrita como relógio de parede: "2026-11-09 08:00". */
const mcp = (s: string) => new Date(`${s.replace(" ", "T")}:00-03:00`);

const SEM_SABADO: HorarioUtil = { inicio: "08:00", fim: "18:00", dias: [1, 2, 3, 4, 5], sabado: false, sabadoFim: "12:00" };
const COM_SABADO: HorarioUtil = { ...SEM_SABADO, sabado: true };

const LINHA: LinhaDaConfiguracao = {
  horario_inicio: "08:00:00",
  horario_fim: "18:00:00",
  dias_semana: [1, 2, 3, 4, 5],
  grupo_equipe_id: "120363000000000001-group",
  grupo_equipe_ativo: true,
  cobranca_modo: "ligada",
  cobranca_min_pedido: 240,
  cobranca_min_orcamento: 120,
  cobranca_min_gestor: 240,
  cobranca_sabado: false,
  cobranca_sabado_fim: "12:00:00",
  cobranca_ligada_em: "2026-11-01T00:00:00Z",
  cobranca_ensaio_desde: "2026-10-01T00:00:00Z",
};

const CFG: ConfigCobranca = configDaCobranca(LINHA);

function pendencia(extra: Partial<Pendencia> = {}): Pendencia {
  return {
    atendimentoId: "at-1",
    numero: "WA-2611-0109",
    conversaId: "c0ffee00-0000-4000-8000-000000000001",
    abertoEm: mcp("2026-11-09 08:30"),
    fechadoEm: null,
    fila: "comercial",
    conversaStatus: "aberta",
    responsavelId: "u-resp",
    clienteNome: "Maria Souza",
    pediuPorPalavraEm: mcp("2026-11-09 09:00"),
    pediuPorMarcaEm: null,
    orcamentos: [],
    enviosNaConversa: [],
    dispensadoEm: null,
    leadStatus: null,
    cobrancas: [],
    ...extra,
  };
}

function orcamento(extra: Partial<OrcamentoLigado> = {}): OrcamentoLigado {
  return {
    id: "orc-1",
    numero: 123,
    status: "rascunho",
    criadoEm: mcp("2026-11-09 10:00"),
    enviadoEm: null,
    vendedorId: "u-vend",
    ...extra,
  };
}

const EQUIPE: PessoaDaEquipe[] = [
  { id: "u-resp", nome: "Ana Paula Lima", telefone: "(96) 99111-2233", papeis: ["vendedor"] },
  { id: "u-vend", nome: "Bruno Costa", telefone: "96994445566", papeis: ["vendedor"] },
  { id: "u-gest", nome: "Carla Dias", telefone: "96 99777-8899", papeis: ["gestor", "admin"] },
  { id: "u-adm-sem-tel", nome: "Davi Rocha", telefone: null, papeis: ["admin"] },
  { id: "u-prod", nome: "Edu Melo", telefone: null, papeis: ["producao"] },
];

const TELEFONE_DO_CLIENTE = "96981234567";

/* ------------------------------------------------------------------ */

describe("minutos úteis (fuso de Macapá)", () => {
  it("seg a sex das 8h às 18h; 8h00 e 18h00 exatos; noite e madrugada não contam", () => {
    expect(minutosUteisEntre(mcp("2026-11-09 08:00"), mcp("2026-11-09 18:00"), SEM_SABADO)).toBe(600);
    expect(minutosUteisEntre(mcp("2026-11-09 07:00"), mcp("2026-11-09 08:00"), SEM_SABADO)).toBe(0);
    expect(minutosUteisEntre(mcp("2026-11-09 18:00"), mcp("2026-11-09 23:59"), SEM_SABADO)).toBe(0);
    expect(minutosUteisEntre(mcp("2026-11-09 17:50"), mcp("2026-11-10 08:10"), SEM_SABADO)).toBe(20);
    expect(minutosUteisEntre(mcp("2026-11-09 06:00"), mcp("2026-11-10 07:00"), SEM_SABADO)).toBe(600);
    // segundos quebrados arredondam para baixo
    expect(minutosUteisEntre(mcp("2026-11-09 09:00"), new Date(mcp("2026-11-09 09:01").getTime() + 59_000), SEM_SABADO)).toBe(1);
  });

  it("dentro do horário: 8h00 dentro, 18h00 fora, 7h59 fora", () => {
    expect(dentroDoHorarioUtil(mcp("2026-11-09 08:00"), SEM_SABADO)).toBe(true);
    expect(dentroDoHorarioUtil(mcp("2026-11-09 17:59"), SEM_SABADO)).toBe(true);
    expect(dentroDoHorarioUtil(mcp("2026-11-09 18:00"), SEM_SABADO)).toBe(false);
    expect(dentroDoHorarioUtil(mcp("2026-11-09 07:59"), SEM_SABADO)).toBe(false);
  });

  it("sábado só com cobranca_sabado, das 8h até cobranca_sabado_fim; domingo nunca", () => {
    expect(minutosUteisEntre(mcp("2026-11-14 00:00"), mcp("2026-11-15 00:00"), SEM_SABADO)).toBe(0);
    expect(minutosUteisEntre(mcp("2026-11-14 00:00"), mcp("2026-11-15 00:00"), COM_SABADO)).toBe(240);
    expect(minutosUteisEntre(mcp("2026-11-14 00:00"), mcp("2026-11-15 00:00"), { ...COM_SABADO, sabadoFim: "13:30" })).toBe(330);
    expect(minutosUteisEntre(mcp("2026-11-15 00:00"), mcp("2026-11-16 00:00"), COM_SABADO)).toBe(0);
    expect(dentroDoHorarioUtil(mcp("2026-11-14 10:00"), SEM_SABADO)).toBe(false);
    expect(dentroDoHorarioUtil(mcp("2026-11-14 10:00"), COM_SABADO)).toBe(true);
    expect(dentroDoHorarioUtil(mcp("2026-11-14 12:00"), COM_SABADO)).toBe(false);
    expect(dentroDoHorarioUtil(mcp("2026-11-15 10:00"), COM_SABADO)).toBe(false);
  });

  it("fim de semana no meio do intervalo; fim antes do início dá 0", () => {
    expect(minutosUteisEntre(mcp("2026-11-13 17:00"), mcp("2026-11-16 09:00"), SEM_SABADO)).toBe(120);
    expect(minutosUteisEntre(mcp("2026-11-13 17:00"), mcp("2026-11-16 09:00"), COM_SABADO)).toBe(360);
    expect(minutosUteisEntre(mcp("2026-11-10 10:00"), mcp("2026-11-09 10:00"), SEM_SABADO)).toBe(0);
    expect(minutosUteisEntre(mcp("2026-11-10 10:00"), mcp("2026-11-10 10:00"), SEM_SABADO)).toBe(0);
    // uma semana inteira: 5 x 600
    expect(minutosUteisEntre(mcp("2026-11-09 00:00"), mcp("2026-11-16 00:00"), SEM_SABADO)).toBe(3000);
  });

  it("virada de dia em UTC às 21h de Macapá não muda a conta (TZ=UTC)", () => {
    // 20h de segunda em Macapá já é terça em UTC; o relógio continua parado até 8h de terça.
    expect(mcp("2026-11-09 21:00").toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(minutosUteisEntre(mcp("2026-11-09 20:00"), mcp("2026-11-10 09:00"), SEM_SABADO)).toBe(60);
    // Sexta 21h de Macapá é sábado em UTC: sem sábado, nada conta até segunda.
    expect(minutosUteisEntre(mcp("2026-11-13 21:00"), mcp("2026-11-16 08:30"), SEM_SABADO)).toBe(30);
    expect(dentroDoHorarioUtil(new Date("2026-11-10T00:30:00Z"), SEM_SABADO)).toBe(false);
    expect(dentroDoHorarioUtil(new Date("2026-11-09T20:59:00Z"), SEM_SABADO)).toBe(true);
  });

  it("dia fora da lista do WhatsApp não conta", () => {
    const semQuarta = { ...SEM_SABADO, dias: [1, 2, 4, 5] };
    expect(minutosUteisEntre(mcp("2026-11-11 00:00"), mcp("2026-11-12 00:00"), semQuarta)).toBe(0);
  });
});

describe("horário, horas e configuração", () => {
  it("horarioDaCobranca: tira sábado e domingo de dias_semana e lê time do Postgres", () => {
    const h = horarioDaCobranca({ ...LINHA, dias_semana: [1, 2, 3, 4, 5, 6, 7], cobranca_sabado: true });
    expect(h).toEqual({ inicio: "08:00", fim: "18:00", dias: [1, 2, 3, 4, 5], sabado: true, sabadoFim: "12:00" });
  });

  it("horário por extenso, sem travessão nem seta", () => {
    expect(horarioPorExtenso(SEM_SABADO)).toBe("segunda a sexta, das 8h às 18h");
    expect(horarioPorExtenso(COM_SABADO)).toBe("segunda a sexta, das 8h às 18h; sábado, das 8h às 12h");
    expect(horarioPorExtenso({ ...SEM_SABADO, inicio: "08:30", dias: [1, 3, 5] })).toBe(
      "segunda, quarta e sexta, das 8h30 às 18h",
    );
  });

  it("horas com vírgula, meia hora para baixo", () => {
    expect(horasUteis(240)).toBe("4 h úteis");
    expect(horasUteis(270)).toBe("4,5 h úteis");
    expect(horasUteis(299)).toBe("4,5 h úteis");
    expect(horasUteis(150)).toBe("2,5 h úteis");
    expect(horasUteis(45)).toBe("45 min úteis");
    expect(minutosEmHoras(240)).toBe("4 h");
    expect(minutosEmHoras(90)).toBe("1,5 h");
    expect(minutosEmHoras(30)).toBe("30 min");
  });

  it("configDaCobranca: modo desconhecido vira desligada; grupo só quando ligado e no formato", () => {
    expect(configDaCobranca({ ...LINHA, cobranca_modo: "qualquer" }).modo).toBe("desligada");
    expect(CFG.grupoDestino).toBe("120363000000000001-group");
    expect(configDaCobranca({ ...LINHA, grupo_equipe_ativo: false }).grupoDestino).toBeNull();
    expect(configDaCobranca({ ...LINHA, grupo_equipe_id: "5596991112233" }).grupoDestino).toBeNull();
    expect(CFG.minPedido).toBe(240);
    expect(CFG.minOrcamento).toBe(120);
    expect(CFG.minGestor).toBe(240);
  });

  it("corte: ligadaEm no ligada, ensaioDesde no ensaio, nada desligada", () => {
    expect(corteDaCobranca(CFG)?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(corteDaCobranca({ ...CFG, modo: "ensaio" })?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(corteDaCobranca({ ...CFG, modo: "desligada" })).toBeNull();
  });
});

describe("decidirCobranca", () => {
  it("o pedido começa no primeiro sinal; orçamento de antes da abertura (mais de 2 h) não conta", () => {
    const p = pendencia({
      pediuPorPalavraEm: mcp("2026-11-09 11:00"),
      pediuPorMarcaEm: mcp("2026-11-09 10:30"),
      orcamentos: [orcamento({ criadoEm: mcp("2026-11-09 10:00") }), orcamento({ id: "velho", criadoEm: mcp("2026-11-02 10:00") })],
    });
    expect(inicioDoPedido(p)?.getTime()).toBe(mcp("2026-11-09 10:00").getTime());
    expect(inicioDoPedido(pendencia({ pediuPorPalavraEm: null }))).toBeNull();
  });

  it("nível 1 por pedido sem orçamento aos 240 min úteis", () => {
    const p = pendencia();
    expect(decidirCobranca(p, CFG, mcp("2026-11-09 12:59"))).toEqual({ cobrar: false, motivo: "ainda_no_prazo" });
    const d = decidirCobranca(p, CFG, mcp("2026-11-09 13:00"));
    expect(d).toMatchObject({ cobrar: true, nivel: 1, motivo: "pedido_sem_orcamento", minutosUteis: 240, orcamento: null });
  });

  it("nível 1 por orçamento parado aos 120 min úteis", () => {
    const p = pendencia({ pediuPorPalavraEm: null, orcamentos: [orcamento()] });
    expect(decidirCobranca(p, CFG, mcp("2026-11-09 11:59"))).toEqual({ cobrar: false, motivo: "ainda_no_prazo" });
    expect(decidirCobranca(p, CFG, mcp("2026-11-09 12:00"))).toMatchObject({
      cobrar: true,
      nivel: 1,
      motivo: "orcamento_parado",
      minutosUteis: 120,
      orcamento: { id: "orc-1", numero: 123 },
    });
  });

  it("o relógio para à noite: pedido às 17h cobra às 11h do dia seguinte", () => {
    const p = pendencia({ pediuPorPalavraEm: mcp("2026-11-09 17:00") });
    expect(decidirCobranca(p, CFG, mcp("2026-11-10 10:59"))).toMatchObject({ cobrar: false });
    expect(decidirCobranca(p, CFG, mcp("2026-11-10 11:00"))).toMatchObject({ cobrar: true, nivel: 1 });
  });

  it("pedido feito fora do horário conta a partir das 8h", () => {
    const p = pendencia({ pediuPorPalavraEm: mcp("2026-11-09 22:00"), abertoEm: mcp("2026-11-09 22:00") });
    expect(decidirCobranca(p, CFG, mcp("2026-11-10 11:59"))).toMatchObject({ cobrar: false, motivo: "ainda_no_prazo" });
    expect(decidirCobranca(p, CFG, mcp("2026-11-10 12:00"))).toMatchObject({ cobrar: true, minutosUteis: 240 });
  });

  it("nível 2 só 240 min úteis depois do nível 1 do mesmo modo; teto de 2", () => {
    const n1 = { nivel: 1 as const, modo: "ligada" as const, em: mcp("2026-11-09 13:00") };
    const p = pendencia({ cobrancas: [n1] });
    expect(decidirCobranca(p, CFG, mcp("2026-11-09 16:59"))).toEqual({ cobrar: false, motivo: "ainda_no_prazo" });
    expect(decidirCobranca(p, CFG, mcp("2026-11-09 17:00"))).toMatchObject({
      cobrar: true,
      nivel: 2,
      motivo: "pedido_sem_orcamento",
      minutosUteis: 480,
    });
    const comOrcamento = pendencia({ cobrancas: [n1], orcamentos: [orcamento()] });
    expect(decidirCobranca(comOrcamento, CFG, mcp("2026-11-09 17:00"))).toMatchObject({
      nivel: 2,
      motivo: "orcamento_parado",
      minutosUteis: 420,
    });
    const teto = pendencia({ cobrancas: [n1, { nivel: 2, modo: "ligada", em: mcp("2026-11-09 17:00") }] });
    expect(decidirCobranca(teto, CFG, mcp("2026-11-13 17:00"))).toEqual({ cobrar: false, motivo: "teto" });
  });

  it("cada parada: fechado, resolvida ou arquivada, dispensa, lead perdido", () => {
    const agora = mcp("2026-11-10 17:00");
    const motivo = (extra: Partial<Pendencia>) => decidirCobranca(pendencia(extra), CFG, agora);
    expect(motivo({})).toMatchObject({ cobrar: true });
    expect(motivo({ fechadoEm: mcp("2026-11-10 09:00") })).toEqual({ cobrar: false, motivo: "atendimento_fechado" });
    expect(motivo({ conversaStatus: "resolvida" })).toEqual({ cobrar: false, motivo: "conversa_resolvida" });
    expect(motivo({ conversaStatus: "arquivada" })).toEqual({ cobrar: false, motivo: "conversa_resolvida" });
    expect(motivo({ dispensadoEm: mcp("2026-11-10 09:00") })).toEqual({ cobrar: false, motivo: "dispensada" });
    expect(motivo({ leadStatus: "perdido" })).toEqual({ cobrar: false, motivo: "lead_perdido" });
    expect(motivo({ pediuPorPalavraEm: null })).toEqual({ cobrar: false, motivo: "sem_pedido" });
  });

  it("cada parada: orçamento fora de rascunho, PDF ou frase depois do pedido, transferida sem orçamento", () => {
    const agora = mcp("2026-11-10 17:00");
    const motivo = (extra: Partial<Pendencia>) => decidirCobranca(pendencia(extra), CFG, agora);
    for (const status of ["enviado", "aprovado", "convertido"]) {
      expect(motivo({ orcamentos: [orcamento({ status })] })).toEqual({ cobrar: false, motivo: "orcamento_enviado" });
    }
    expect(motivo({ orcamentos: [orcamento({ enviadoEm: mcp("2026-11-09 11:00") })] })).toEqual({
      cobrar: false,
      motivo: "orcamento_enviado",
    });
    for (const status of ["rejeitado", "expirado"]) {
      expect(motivo({ orcamentos: [orcamento({ status })] })).toEqual({ cobrar: false, motivo: "orcamento_encerrado" });
    }
    expect(motivo({ enviosNaConversa: [mcp("2026-11-09 10:00")] })).toEqual({ cobrar: false, motivo: "enviado_na_conversa" });
    // envio de ANTES do pedido não para a cobrança
    expect(motivo({ enviosNaConversa: [mcp("2026-11-09 08:40")] })).toMatchObject({ cobrar: true });
    expect(motivo({ fila: "producao" })).toEqual({ cobrar: false, motivo: "transferida_sem_orcamento" });
    // transferida COM orçamento parado continua cobrando
    expect(motivo({ fila: "producao", orcamentos: [orcamento()] })).toMatchObject({ cobrar: true });
  });

  it("corte: pedido antes de ligadaEm (ou ensaioDesde) nunca cobra", () => {
    const agora = mcp("2026-11-10 17:00");
    const p = pendencia();
    expect(decidirCobranca(p, { ...CFG, ligadaEm: mcp("2026-11-09 09:01") }, agora)).toEqual({
      cobrar: false,
      motivo: "antes_do_corte",
    });
    expect(decidirCobranca(p, { ...CFG, ligadaEm: mcp("2026-11-09 09:00") }, agora)).toMatchObject({ cobrar: true });
    expect(decidirCobranca(p, { ...CFG, ligadaEm: null }, agora)).toEqual({ cobrar: false, motivo: "antes_do_corte" });
    expect(decidirCobranca(p, { ...CFG, modo: "ensaio", ensaioDesde: mcp("2026-11-10 08:00") }, agora)).toEqual({
      cobrar: false,
      motivo: "antes_do_corte",
    });
  });

  it("desligada e fora do horário nunca cobram", () => {
    const p = pendencia({ pediuPorPalavraEm: mcp("2026-11-02 09:00") });
    expect(decidirCobranca(p, { ...CFG, modo: "desligada" }, mcp("2026-11-10 17:00"))).toEqual({
      cobrar: false,
      motivo: "desligada",
    });
    expect(decidirCobranca(p, CFG, mcp("2026-11-10 19:00"))).toEqual({ cobrar: false, motivo: "fora_do_horario" });
    expect(decidirCobranca(p, CFG, mcp("2026-11-14 10:00"))).toEqual({ cobrar: false, motivo: "fora_do_horario" });
    expect(decidirCobranca(p, CFG, mcp("2026-11-15 10:00"))).toEqual({ cobrar: false, motivo: "fora_do_horario" });
  });

  it("cobrança feita no ensaio não conta no modo ligada", () => {
    const ensaio = [
      { nivel: 1 as const, modo: "ensaio" as const, em: mcp("2026-11-09 13:00") },
      { nivel: 2 as const, modo: "ensaio" as const, em: mcp("2026-11-09 17:00") },
    ];
    const p = pendencia({ cobrancas: ensaio });
    expect(decidirCobranca(p, CFG, mcp("2026-11-10 17:00"))).toMatchObject({ cobrar: true, nivel: 1 });
    expect(decidirCobranca(p, { ...CFG, modo: "ensaio" }, mcp("2026-11-10 17:00"))).toEqual({ cobrar: false, motivo: "teto" });
  });
});

describe("quemCitar", () => {
  const n1: DecisaoDeCobrar = {
    cobrar: true,
    nivel: 1,
    motivo: "orcamento_parado",
    minutosUteis: 120,
    orcamento: orcamento(),
    pedidoEm: mcp("2026-11-09 09:00"),
  };

  it("telefone da equipe vira 55 + DDD + número", () => {
    expect(numeroParaMencao("(96) 99111-2233")).toBe("5596991112233");
    expect(numeroParaMencao("5596991112233")).toBe("5596991112233");
    expect(numeroParaMencao(null)).toBeNull();
    expect(numeroParaMencao("123")).toBeNull();
  });

  it("responsável e vendedor diferentes: os dois; iguais: um só", () => {
    expect(quemCitar(pendencia(), n1, EQUIPE)).toEqual([
      { id: "u-resp", nome: "Ana", papel: "responsavel", mencao: "5596991112233" },
      { id: "u-vend", nome: "Bruno", papel: "vendedor", mencao: "5596994445566" },
    ]);
    const mesmo = { ...n1, orcamento: orcamento({ vendedorId: "u-resp" }) };
    expect(quemCitar(pendencia(), mesmo, EQUIPE).map((c) => c.id)).toEqual(["u-resp"]);
    // sem orçamento parado, o vendedor não entra
    expect(quemCitar(pendencia(), { ...n1, motivo: "pedido_sem_orcamento", orcamento: null }, EQUIPE).map((c) => c.id)).toEqual([
      "u-resp",
    ]);
  });

  it("sem responsável na equipe: gerência já no nível 1", () => {
    const semResp = quemCitar(pendencia({ responsavelId: null }), { ...n1, orcamento: null }, EQUIPE);
    expect(semResp).toEqual([{ id: "u-gest", nome: "Carla", papel: "gerencia", mencao: "5596997778899" }]);
  });

  it("nível 2 soma gestor e admin ativos com telefone, sem repetir", () => {
    const n2 = { ...n1, nivel: 2 as const };
    expect(quemCitar(pendencia(), n2, EQUIPE).map((c) => [c.id, c.papel])).toEqual([
      ["u-resp", "responsavel"],
      ["u-vend", "vendedor"],
      ["u-gest", "gerencia"],
    ]);
    // a gestora é a própria responsável: aparece uma vez só
    const gestoraResponsavel = quemCitar(pendencia({ responsavelId: "u-gest" }), { ...n2, orcamento: null }, EQUIPE);
    expect(gestoraResponsavel.map((c) => [c.id, c.papel])).toEqual([["u-gest", "responsavel"]]);
  });

  it("quem saiu nunca é citado; sem telefone vai o nome sem menção", () => {
    // "u-saiu" não vem de whatsapp_cobranca_equipe (inativo ou sem papel)
    const saiu = quemCitar(pendencia({ responsavelId: "u-saiu" }), { ...n1, orcamento: orcamento({ vendedorId: "u-saiu" }) }, EQUIPE);
    expect(saiu.map((c) => c.id)).toEqual(["u-gest"]);
    const semTelefone = quemCitar(pendencia({ responsavelId: "u-prod" }), { ...n1, orcamento: null }, EQUIPE);
    expect(semTelefone).toEqual([{ id: "u-prod", nome: "Edu", papel: "responsavel", mencao: null }]);
    const texto = textoDaCobranca(pendencia(), n1, semTelefone);
    expect(texto).toContain("\nEdu\n");
    expect(texto).not.toContain("@Edu");
  });
});

describe("texto e agrupamento", () => {
  const pedido: DecisaoDeCobrar = {
    cobrar: true,
    nivel: 1,
    motivo: "pedido_sem_orcamento",
    minutosUteis: 240,
    orcamento: null,
    pedidoEm: mcp("2026-11-09 09:00"),
  };
  const parado: DecisaoDeCobrar = { ...pedido, motivo: "orcamento_parado", minutosUteis: 120, orcamento: orcamento() };
  const ana: Citado = { id: "u-resp", nome: "Ana", papel: "responsavel", mencao: "5596991112233" };
  const bruno: Citado = { id: "u-vend", nome: "Bruno", papel: "vendedor", mencao: "5596994445566" };
  const carla: Citado = { id: "u-gest", nome: "Carla", papel: "gerencia", mencao: "5596997778899" };

  const PROIBIDOS = ["—", "–", "→", "->", "⇒", "=>"];

  it("formato do contrato (pedido e orçamento parado)", () => {
    expect(textoDaCobranca(pendencia(), pedido, [ana, bruno])).toBe(
      [
        "⏰ Orçamento pendente · WA-2611-0109",
        "Cliente: Maria Souza",
        "Pediu orçamento há 4 h úteis e ainda não recebeu.",
        "@5596991112233 @5596994445566",
        "Abrir: https://bexprint.com.br/whatsapp?conversa=c0ffee00-0000-4000-8000-000000000001",
      ].join("\n"),
    );
    expect(textoDaCobranca(pendencia(), parado, [ana]).split("\n")[2]).toBe(
      "Orçamento nº 123 criado há 2 h úteis e ainda não foi enviado.",
    );
  });

  it("nível 2 e sem responsável chamam a gerência", () => {
    const n2 = textoDaCobranca(pendencia(), { ...pedido, nivel: 2, minutosUteis: 270 }, [ana, carla]).split("\n");
    expect(n2[0]).toBe("⏰ Orçamento pendente · WA-2611-0109 · 2ª cobrança");
    expect(n2[2]).toBe("Pediu orçamento há 4,5 h úteis e ainda não recebeu.");
    expect(n2[3]).toBe("@5596991112233");
    expect(n2[4]).toBe("Gerência: @5596997778899");
    const semResp = textoDaCobranca(pendencia({ responsavelId: null }), pedido, [carla]).split("\n");
    expect(semResp[3]).toBe("Sem responsável. Gerência: @5596997778899");
  });

  it("sem travessão, sem seta, sem telefone do cliente; horas com vírgula", () => {
    const nomes = [
      TELEFONE_DO_CLIENTE,
      "+55 (96) 98123-4567",
      "Loja X — 96 98123.4567",
      "Cliente -> 5596981234567",
      null,
      "   ",
    ];
    for (const nome of nomes) {
      const texto = textoDaCobranca(pendencia({ clienteNome: nome }), { ...pedido, minutosUteis: 150 }, [ana]);
      for (const proibido of PROIBIDOS) expect(texto).not.toContain(proibido);
      expect(texto.replace(/\D/g, "")).not.toContain("81234567");
      expect(texto).toContain("2,5 h úteis");
      for (const linha of texto.split("\n")) expect(linha).toBe(linha.trimStart());
    }
    expect(nomeSemTelefone(TELEFONE_DO_CLIENTE)).toBe("Sem nome");
    expect(nomeSemTelefone(null)).toBe("Sem nome");
    expect(nomeSemTelefone("Gráfica 2 Irmãos")).toBe("Gráfica 2 Irmãos");
    expect(nomeSemTelefone("Loja X — 96 98123.4567")).toBe("Loja X");
    expect(nomeSemTelefone("@5596991112233 Maria")).toBe("Maria");
  });

  it("o @número do texto é o que vai em mencionar", () => {
    const [envio] = agruparNaAbertura([{ pendencia: pendencia(), decisao: pedido, citados: [ana, bruno] }]);
    const noTexto = [...envio.texto.matchAll(/@(\d+)/g)].map((m) => m[1]);
    expect(envio.mencionar).toEqual(noTexto);
    expect(envio.mencionar).toEqual(["5596991112233", "5596994445566"]);
  });

  it("link https://bexprint.com.br/whatsapp?conversa=<id>", () => {
    expect(linkDaConversa("abc-123")).toBe("https://bexprint.com.br/whatsapp?conversa=abc-123");
    expect(textoDaCobranca(pendencia(), pedido, [ana])).toContain(
      "Abrir: https://bexprint.com.br/whatsapp?conversa=c0ffee00-0000-4000-8000-000000000001",
    );
  });

  it("sobrevive a renderizarTemplate('{{texto}}') sem mudar um caractere", () => {
    const textos = [
      textoDaCobranca(pendencia(), pedido, [ana, bruno]),
      textoDaCobranca(pendencia({ clienteNome: "Maria  Souza ." }), { ...parado, nivel: 2 }, [ana, { ...bruno, mencao: null }, carla]),
      textoDaCobranca(pendencia({ clienteNome: TELEFONE_DO_CLIENTE, responsavelId: null }), pedido, [carla]),
      ...agruparNaAbertura(
        [1, 2, 3, 4].map((i) => ({
          pendencia: pendencia({ atendimentoId: `at-${i}`, numero: `WA-2611-010${i}`, clienteNome: `Cliente ${i}` }),
          decisao: i === 2 ? { ...parado, nivel: 2 as const } : pedido,
          citados: i === 2 ? [ana, carla] : [ana],
        })),
      ).map((e) => e.texto),
    ];
    for (const texto of textos) expect(renderizarTemplate("{{texto}}", { texto })).toBe(texto);
  });

  it("3 itens: 3 mensagens; 4 ou mais: uma mensagem com a lista e as menções sem repetir", () => {
    const item = (i: number, extra: Partial<ItemDeCobranca> = {}): ItemDeCobranca => ({
      pendencia: pendencia({
        atendimentoId: `at-${i}`,
        numero: `WA-2611-010${i}`,
        conversaId: `conv-${i}`,
        clienteNome: i === 1 ? "Maria Souza" : `Cliente ${i}`,
      }),
      decisao: { ...pedido, minutosUteis: 360 },
      citados: [ana],
      ...extra,
    });

    const tres = agruparNaAbertura([item(1), item(2), item(3)]);
    expect(tres).toHaveLength(3);
    expect(tres.every((e) => !e.agrupada && e.itens.length === 1)).toBe(true);

    const quatro = agruparNaAbertura([
      item(1),
      item(2, { decisao: { ...parado, nivel: 2, orcamento: orcamento({ numero: 211 }), minutosUteis: 180 }, citados: [ana, bruno, carla] }),
      item(3, { citados: [bruno] }),
      item(4),
    ]);
    expect(quatro).toHaveLength(1);
    const [envio] = quatro;
    expect(envio.agrupada).toBe(true);
    expect(envio.itens).toHaveLength(4);
    expect(envio.texto).toBe(
      [
        "⏰ 4 orçamentos pendentes",
        "1. WA-2611-0101 · Maria Souza · pediu há 6 h úteis",
        "https://bexprint.com.br/whatsapp?conversa=conv-1",
        "2. WA-2611-0102 · Cliente 2 · orçamento nº 211 parado há 3 h úteis · 2ª cobrança",
        "https://bexprint.com.br/whatsapp?conversa=conv-2",
        "3. WA-2611-0103 · Cliente 3 · pediu há 6 h úteis",
        "https://bexprint.com.br/whatsapp?conversa=conv-3",
        "4. WA-2611-0104 · Cliente 4 · pediu há 6 h úteis",
        "https://bexprint.com.br/whatsapp?conversa=conv-4",
        "@5596991112233 @5596994445566",
        "Gerência: @5596997778899",
      ].join("\n"),
    );
    expect(envio.mencionar).toEqual(["5596991112233", "5596994445566", "5596997778899"]);
    for (const proibido of PROIBIDOS) expect(envio.texto).not.toContain(proibido);

    // sem nível 2 e todos com responsável: sem linha da gerência
    const semGerencia = agruparNaAbertura([item(1), item(2), item(3), item(4)]);
    expect(semGerencia[0].texto).not.toContain("Gerência");
    expect(semGerencia[0].mencionar).toEqual(["5596991112233"]);
    expect(agruparNaAbertura([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Achados da revisão (12/11): responsável inativo, rascunho novo, nome */
/* ------------------------------------------------------------------ */

describe("revisão: responsável do atendimento que saiu da equipe", () => {
  const n1: DecisaoDeCobrar = {
    cobrar: true,
    nivel: 1,
    motivo: "pedido_sem_orcamento",
    minutosUteis: 250,
    orcamento: null,
    pedidoEm: mcp("2026-11-09 09:00"),
  };

  it("o responsável do atendimento fora da equipe cede a vez ao da conversa (ativo)", () => {
    const citados = quemCitar(pendencia({ responsavelId: "u-saiu", responsavelConversaId: "u-vend" }), n1, EQUIPE);
    expect(citados.map((c) => [c.id, c.papel])).toEqual([["u-vend", "responsavel"]]);
  });

  it("o do atendimento ativo vem primeiro; sem nenhum dos dois na equipe, a gerência", () => {
    const dois = quemCitar(pendencia({ responsavelId: "u-resp", responsavelConversaId: "u-vend" }), n1, EQUIPE);
    expect(dois.map((c) => c.id)).toEqual(["u-resp"]);
    const nenhum = quemCitar(pendencia({ responsavelId: "u-saiu", responsavelConversaId: "u-saiu-2" }), n1, EQUIPE);
    expect(nenhum.every((c) => c.papel === "gerencia")).toBe(true);
    expect(nenhum.length).toBeGreaterThan(0);
  });
});

describe("revisão: rascunho criado depois de um orçamento enviado", () => {
  const agora = mcp("2026-11-10 17:00");
  const enviado = orcamento({ id: "orc-a", numero: 100, status: "enviado", criadoEm: mcp("2026-11-09 10:00"), enviadoEm: mcp("2026-11-09 11:00") });

  it("rascunho novo, parado há mais de 120 min úteis, é cobrado como orçamento parado", () => {
    const novo = orcamento({ id: "orc-b", numero: 101, status: "rascunho", criadoEm: mcp("2026-11-10 09:00") });
    const d = decidirCobranca(pendencia({ orcamentos: [enviado, novo] }), CFG, agora);
    expect(d).toMatchObject({ cobrar: true, nivel: 1, motivo: "orcamento_parado" });
    expect(d.cobrar && d.orcamento?.id).toBe("orc-b");
  });

  it("rascunho novo ainda no prazo: não cobra, nem pelo pedido antigo", () => {
    const novo = orcamento({ id: "orc-b", numero: 101, status: "rascunho", criadoEm: mcp("2026-11-10 16:00") });
    expect(decidirCobranca(pendencia({ orcamentos: [enviado, novo] }), CFG, agora)).toEqual({
      cobrar: false,
      motivo: "ainda_no_prazo",
    });
  });

  it("rascunho ANTIGO (criado antes do envio) continua parado pelo envio", () => {
    const antigo = orcamento({ id: "orc-b", status: "rascunho", criadoEm: mcp("2026-11-09 09:30") });
    expect(decidirCobranca(pendencia({ orcamentos: [antigo, enviado] }), CFG, agora)).toEqual({
      cobrar: false,
      motivo: "orcamento_enviado",
    });
  });

  it("rejeitado e rascunho novo: o rascunho novo é cobrado; sem rascunho novo segue encerrado", () => {
    const rejeitado = orcamento({ id: "orc-r", status: "rejeitado", criadoEm: mcp("2026-11-09 10:00") });
    const novo = orcamento({ id: "orc-b", status: "rascunho", criadoEm: mcp("2026-11-10 09:00") });
    expect(decidirCobranca(pendencia({ orcamentos: [rejeitado, novo] }), CFG, agora)).toMatchObject({ cobrar: true });
    expect(decidirCobranca(pendencia({ orcamentos: [rejeitado] }), CFG, agora)).toEqual({
      cobrar: false,
      motivo: "orcamento_encerrado",
    });
  });

  it("o envio por PDF anterior ao rascunho novo não cala o rascunho novo; o posterior cala", () => {
    const novo = orcamento({ id: "orc-b", status: "rascunho", criadoEm: mcp("2026-11-10 09:00") });
    const base = { orcamentos: [enviado, novo] };
    expect(decidirCobranca(pendencia({ ...base, enviosNaConversa: [mcp("2026-11-09 11:00")] }), CFG, agora)).toMatchObject({ cobrar: true });
    expect(decidirCobranca(pendencia({ ...base, enviosNaConversa: [mcp("2026-11-10 10:00")] }), CFG, agora)).toEqual({
      cobrar: false,
      motivo: "enviado_na_conversa",
    });
  });
});

describe("revisão: nome do cliente com telefone entre parênteses", () => {
  it("não deixa parêntese solto", () => {
    expect(nomeSemTelefone("João (96) 99123-4567 Silva")).toBe("João Silva");
    expect(nomeSemTelefone("Maria (96 99123-4567)")).toBe("Maria");
    expect(nomeSemTelefone("Gráfica (Ltda)")).toBe("Gráfica (Ltda)");
    expect(nomeSemTelefone("João ( ) Silva")).toBe("João Silva");
  });
});
