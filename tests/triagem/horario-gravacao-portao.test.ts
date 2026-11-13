import { describe, expect, it } from "vitest";
import {
  aplicarDadosNovos,
  CONFIG_PADRAO_DA_TRIAGEM,
  chavesDeBloqueio,
  DADOS_VAZIOS,
  decidirNomeDoLead,
  dentroDoHorario,
  detectarRobo,
  diasEmTexto,
  enderecoParaCopiar,
  HORARIO_SEMENTE,
  horarioEmTexto,
  podeCopiarTelefoneAlternativo,
  portaoDaTriagem,
  relogioDeBelem,
  SEMENTES_DO_QUADRO,
  subirRamo,
} from "../../src/domain/whatsapp/triagem";

// Belém é UTC-3, sem horário de verão.
const belem = (iso: string) => Date.parse(`${iso}-03:00`);

describe("horário de atendimento em Belém", () => {
  it("segunda às 10h está aberto; domingo e sábado, não (semente)", () => {
    expect(dentroDoHorario(belem("2026-11-16T10:00:00"), HORARIO_SEMENTE)).toBe(true);
    expect(dentroDoHorario(belem("2026-11-15T10:00:00"), HORARIO_SEMENTE)).toBe(false);
    expect(dentroDoHorario(belem("2026-11-14T10:00:00"), HORARIO_SEMENTE)).toBe(false);
  });
  it("abre às 8h exatas e fecha às 18h exatas", () => {
    expect(dentroDoHorario(belem("2026-11-16T07:59:00"), HORARIO_SEMENTE)).toBe(false);
    expect(dentroDoHorario(belem("2026-11-16T08:00:00"), HORARIO_SEMENTE)).toBe(true);
    expect(dentroDoHorario(belem("2026-11-16T17:59:00"), HORARIO_SEMENTE)).toBe(true);
    expect(dentroDoHorario(belem("2026-11-16T18:00:00"), HORARIO_SEMENTE)).toBe(false);
  });
  it("não depende do fuso do computador: 21h UTC de domingo é 18h de domingo em Belém", () => {
    expect(relogioDeBelem(Date.parse("2026-11-16T01:30:00Z"))).toMatchObject({
      diaSemana: 0,
      data: "2026-11-15",
    });
    expect(dentroDoHorario(Date.parse("2026-11-16T11:30:00Z"), HORARIO_SEMENTE)).toBe(true); // 08:30 de segunda
  });
  it("aceita Date e número", () => {
    expect(dentroDoHorario(new Date("2026-11-16T13:00:00Z"), HORARIO_SEMENTE)).toBe(true);
  });
  it("sábado aberto quando o dono decidir", () => {
    const comSabado = {
      ...HORARIO_SEMENTE,
      semana: HORARIO_SEMENTE.semana.map((h) =>
        h.diaSemana === 6 ? { ...h, ativo: true, fecha: "12:00" } : h,
      ),
    };
    expect(dentroDoHorario(belem("2026-11-14T10:00:00"), comSabado)).toBe(true);
    expect(dentroDoHorario(belem("2026-11-14T13:00:00"), comSabado)).toBe(false);
    // sábado fecha ao meio-dia: o texto não pode dizer que ele vai até as 18h
    expect(horarioEmTexto(comSabado)).toEqual({
      abre: "8h",
      fecha: "18h",
      dias: "de segunda a sexta, e aos sábados das 8h às 12h",
    });
  });
  it("dias ativos com horários diferentes são agrupados por horário", () => {
    const semana = (f: (d: number) => { abre: string; fecha: string; ativo: boolean }) => ({
      semana: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, ...f(d) })),
    });
    // mesmo horário em todos os dias ativos: texto de sempre
    expect(
      horarioEmTexto(semana((d) => ({ abre: "08:00", fecha: "18:00", ativo: d >= 1 && d <= 6 }))),
    ).toEqual({ abre: "8h", fecha: "18h", dias: "de segunda a sábado" });
    // sexta fecha mais cedo: o grupo maior (segunda a quinta) manda em abre e fecha
    expect(
      horarioEmTexto(
        semana((d) => ({ abre: "08:00", fecha: d === 5 ? "16:00" : "18:00", ativo: d >= 1 && d <= 5 })),
      ),
    ).toEqual({ abre: "8h", fecha: "18h", dias: "de segunda a quinta, e às sextas das 8h às 16h" });
    // só sábado e domingo, horários diferentes, empate de tamanho: ganha o que começa mais cedo na semana (domingo)
    expect(
      horarioEmTexto(
        semana((d) => ({ abre: "09:00", fecha: d === 6 ? "13:00" : "12:30", ativo: d === 0 || d === 6 })),
      ),
    ).toEqual({ abre: "9h", fecha: "12h30", dias: "aos domingos, e aos sábados das 9h às 13h" });
  });
  it("feriado fechado e feriado com horário próprio", () => {
    const f = {
      ...HORARIO_SEMENTE,
      feriados: [
        { data: "2026-11-20", fechado: true },
        { data: "2026-12-24", fechado: false, abre: "08:00", fecha: "12:00" },
      ],
    };
    expect(dentroDoHorario(belem("2026-11-20T10:00:00"), f)).toBe(false);
    expect(dentroDoHorario(belem("2026-12-24T10:00:00"), f)).toBe(true);
    expect(dentroDoHorario(belem("2026-12-24T14:00:00"), f)).toBe(false);
  });
  it("o horário vira texto para as variáveis abre, fecha e dias", () => {
    expect(horarioEmTexto(HORARIO_SEMENTE)).toEqual({
      abre: "8h",
      fecha: "18h",
      dias: "de segunda a sexta",
    });
    const meia = {
      semana: HORARIO_SEMENTE.semana.map((h) => ({ ...h, abre: "08:30", fecha: "17:30" })),
    };
    expect(horarioEmTexto(meia)).toMatchObject({ abre: "8h30", fecha: "17h30" });
    expect(
      horarioEmTexto({ semana: HORARIO_SEMENTE.semana.map((h) => ({ ...h, ativo: false })) }),
    ).toBeNull();
    expect(diasEmTexto([1, 3, 5])).toBe("segunda, quarta e sexta");
    expect(diasEmTexto([2])).toBe("às terças");
  });
});

describe("gravação: escrita única e ramo que só sobe", () => {
  it("a segunda resposta não sobrescreve a primeira", () => {
    const a = aplicarDadosNovos(DADOS_VAZIOS, { nomeInformado: "Maria Souza", cep: "68900000" });
    const b = aplicarDadosNovos(a, { nomeInformado: "Outra Pessoa", cep: "11111111" });
    expect(b.nomeInformado).toBe("Maria Souza");
    expect(b.cep).toBe("68900000");
  });
  it("marcas booleanas só sobem", () => {
    const a = aplicarDadosNovos(DADOS_VAZIOS, { pediuPreco: true });
    expect(aplicarDadosNovos(a, { pediuPreco: false }).pediuPreco).toBe(true);
  });
  it("o telefone alternativo só troca dentro da própria etapa", () => {
    const a = aplicarDadosNovos(DADOS_VAZIOS, { telefoneAlternativo: "96991112233" });
    expect(aplicarDadosNovos(a, { telefoneAlternativo: "96981408722" }).telefoneAlternativo).toBe(
      "96991112233",
    );
    expect(
      aplicarDadosNovos(
        a,
        { telefoneAlternativo: "96981408722" },
        { permitirTrocaDoAlternativo: true },
      ).telefoneAlternativo,
    ).toBe("96981408722");
  });
  it("o alternativo nunca nasce verificado", () => {
    expect(
      aplicarDadosNovos(DADOS_VAZIOS, { telefoneAlternativo: "96991112233" })
        .telefoneAlternativoVerificado,
    ).toBe(false);
  });
  it("o ramo só sobe", () => {
    expect(subirRamo("cliente", "parceiro")).toBe("parceiro");
    expect(subirRamo("parceiro", "cliente")).toBe("parceiro");
    expect(subirRamo("cliente", "cliente")).toBe("cliente");
  });
});

describe("nome no lead (seção 4.1 com as críticas)", () => {
  const base = { nomeDoPerfil: "mari 🌸", nomeInformado: "Maria Souza", triagemConcluida: true };
  it("só depois da triagem concluída", () => {
    expect(
      decidirNomeDoLead({ ...base, nomeAtualDoLead: "mari 🌸", triagemConcluida: false }),
    ).toEqual({ gravar: false, motivo: "triagem_nao_concluida" });
  });
  it("troca o marcador Lead WhatsApp", () => {
    expect(decidirNomeDoLead({ ...base, nomeAtualDoLead: "Lead WhatsApp 96991112233" })).toEqual({
      gravar: true,
      motivo: "marcador",
    });
    expect(decidirNomeDoLead({ ...base, nomeAtualDoLead: null })).toEqual({
      gravar: true,
      motivo: "marcador",
    });
  });
  it("troca o nome do perfil quando o dito é melhor", () => {
    expect(decidirNomeDoLead({ ...base, nomeAtualDoLead: "mari 🌸" })).toEqual({
      gravar: true,
      motivo: "igual_ao_perfil_e_melhor",
    });
    expect(
      decidirNomeDoLead({
        nomeAtualDoLead: "Maria",
        nomeDoPerfil: "Maria",
        nomeInformado: "Maria Souza",
        triagemConcluida: true,
      }).gravar,
    ).toBe(true);
  });
  it("não troca nome igual ao perfil por um que não é melhor", () => {
    expect(
      decidirNomeDoLead({
        nomeAtualDoLead: "Maria Souza",
        nomeDoPerfil: "Maria Souza",
        nomeInformado: "Maria Souza",
        triagemConcluida: true,
      }),
    ).toEqual({ gravar: false, motivo: "nao_e_melhor" });
  });
  it("nunca toca em nome que a equipe editou", () => {
    expect(decidirNomeDoLead({ ...base, nomeAtualDoLead: "Maria S. (cliente VIP)" })).toEqual({
      gravar: false,
      motivo: "editado_pela_equipe",
    });
  });
  it("nome de uma palavra só substitui marcador, nunca um nome de duas palavras", () => {
    expect(
      decidirNomeDoLead({
        nomeAtualDoLead: "Lead WhatsApp 96991112233",
        nomeDoPerfil: null,
        nomeInformado: "Maria",
        triagemConcluida: true,
      }).gravar,
    ).toBe(true);
    expect(
      decidirNomeDoLead({
        nomeAtualDoLead: "Maria Souza",
        nomeDoPerfil: "Maria Souza",
        nomeInformado: "Maria",
        triagemConcluida: true,
      }).gravar,
    ).toBe(false);
  });
  it("sem nome informado não grava", () => {
    expect(
      decidirNomeDoLead({ ...base, nomeAtualDoLead: "Lead WhatsApp 1", nomeInformado: null })
        .motivo,
    ).toBe("sem_nome");
  });
});

describe("endereço, telefone alternativo e bloqueio", () => {
  const end = { cep: "68900000", rua: "Rua A", bairro: "Centro", cidade: "Macapá", estado: "AP" };
  it("copia só para colunas vazias", () => {
    expect(
      enderecoParaCopiar({
        clienteJaExistia: false,
        cliente: { cep: null, bairro: "Trem" },
        cep: "68900000",
        endereco: end,
        enderecoRecusado: false,
      }),
    ).toEqual({
      cep: "68900000",
      rua: "Rua A",
      cidade: "Macapá",
      estado: "AP",
    });
  });
  it("cliente que já existia nunca tem endereço sobrescrito", () => {
    expect(
      enderecoParaCopiar({
        clienteJaExistia: true,
        cliente: {},
        cep: "68900000",
        endereco: end,
        enderecoRecusado: false,
      }),
    ).toEqual({});
  });
  it("quem recusou o endereço não tem endereço copiado", () => {
    expect(
      enderecoParaCopiar({
        clienteJaExistia: false,
        cliente: {},
        cep: "68900000",
        endereco: end,
        enderecoRecusado: true,
      }),
    ).toEqual({});
    expect(
      enderecoParaCopiar({
        clienteJaExistia: false,
        cliente: {},
        cep: null,
        endereco: null,
        enderecoRecusado: false,
      }),
    ).toEqual({});
  });
  it("o telefone alternativo nunca é copiado sem gente confirmar", () => {
    expect(podeCopiarTelefoneAlternativo({ confirmadoPorGente: false }).copiar).toBe(false);
    expect(podeCopiarTelefoneAlternativo({ confirmadoPorGente: true }).copiar).toBe(true);
  });
  it("o bloqueio vale por conversa, lid e telefone", () => {
    expect(
      chavesDeBloqueio({
        conversaId: "c1",
        chatLid: "123@lid",
        telefoneNormalizado: "96991112233",
      }),
    ).toEqual(["conversa:c1", "lid:123@lid", "telefone:96991112233"]);
    expect(chavesDeBloqueio({ conversaId: "c1", chatLid: "123@lid" })).toEqual([
      "conversa:c1",
      "lid:123@lid",
    ]);
  });
});

describe("portão da triagem (seção 1.2 com as críticas)", () => {
  const abre = () => ({
    estado: "ligada" as const,
    percentual: 100,
    valeAPartirDe: belem("2026-11-01T00:00:00"),
    conversaId: "11111111-2222-4333-8444-555555555555",
    entrada: {
      ehDePessoa: true,
      ehDeGrupo: false,
      texto: "Olá, vi o anúncio de vocês",
      origem: "cliente",
    },
    conversa: {
      criadaEm: belem("2026-11-12T10:00:00"),
      clienteVinculado: false,
      temResponsavel: false,
      arquivada: false,
      modoHumano: false,
      saidasAnteriores: 0,
    },
    telefone: { bloqueado: false, ehDaEquipe: false, jaEConhecido: false, ehDeTeste: false },
    volume: { novasNaHora: 0, novasNoDia: 0, maxPorHora: 12, maxPorDia: 60 },
    quadro: SEMENTES_DO_QUADRO,
  });
  const motivo = (mudanca: Record<string, unknown>) => {
    const base = abre() as Record<string, unknown>;
    return portaoDaTriagem({ ...base, ...mudanca } as ReturnType<typeof abre>);
  };

  it("abre quando tudo está certo", () => {
    expect(portaoDaTriagem(abre())).toEqual({ abre: true, motivo: null, modo: "real" });
    expect(motivo({ estado: "ensaio" })).toEqual({ abre: true, motivo: null, modo: "ensaio" });
  });
  it.each([
    ["desligada", { estado: "desligada" }],
    ["antes_da_data", { valeAPartirDe: belem("2026-11-13T00:00:00") }],
    ["antes_da_data", { valeAPartirDe: null }],
    ["nao_e_pessoa", { entrada: { ...abre().entrada, ehDePessoa: false } }],
    ["grupo", { entrada: { ...abre().entrada, ehDeGrupo: true } }],
    ["equipe", { telefone: { ...abre().telefone, ehDaEquipe: true } }],
    ["cliente_vinculado", { conversa: { ...abre().conversa, clienteVinculado: true } }],
    ["tem_responsavel", { conversa: { ...abre().conversa, temResponsavel: true } }],
    ["arquivada", { conversa: { ...abre().conversa, arquivada: true } }],
    ["modo_humano", { conversa: { ...abre().conversa, modoHumano: true } }],
    ["ja_atendida", { conversa: { ...abre().conversa, saidasAnteriores: 1 } }],
    ["cliente_conhecido", { telefone: { ...abre().telefone, jaEConhecido: true } }],
    ["bloqueado", { telefone: { ...abre().telefone, bloqueado: true } }],
    ["robo", { entrada: { ...abre().entrada, origem: "automacao" } }],
    ["robo", { entrada: { ...abre().entrada, texto: "Seu código de verificação é 123456" } }],
    ["sem_onda_a", { veioDeAnuncioSemOndaA: true }],
    ["freio_de_volume", { volume: { ...abre().volume, novasNaHora: 12 } }],
    ["freio_de_volume", { volume: { ...abre().volume, novasNoDia: 60 } }],
  ])("não abre: %s", (esperado, mudanca) => {
    expect(motivo(mudanca as Record<string, unknown>)).toEqual({
      abre: false,
      motivo: esperado,
      modo: null,
    });
  });

  it("modo teste só deixa passar número de teste", () => {
    expect(motivo({ estado: "teste" }).motivo).toBe("fora_dos_numeros_de_teste");
    expect(
      motivo({ estado: "teste", telefone: { ...abre().telefone, ehDeTeste: true } }).abre,
    ).toBe(true);
  });
  it("só o degrau de teste ignora a exclusão da equipe, e só para número de teste", () => {
    const equipeDeTeste = { ...abre().telefone, ehDaEquipe: true, ehDeTeste: true };
    expect(motivo({ estado: "teste", telefone: equipeDeTeste }).abre).toBe(true);
    expect(motivo({ estado: "ligada", telefone: equipeDeTeste }).motivo).toBe("equipe");
    expect(motivo({ estado: "parcial", telefone: equipeDeTeste }).motivo).toBe("equipe");
  });
  it("modo parcial: sorteio estável pelo identificador da conversa", () => {
    expect(motivo({ estado: "parcial", percentual: 0 }).motivo).toBe("fora_do_sorteio");
    expect(motivo({ estado: "parcial", percentual: 100 }).abre).toBe(true);
    expect(
      motivo({
        estado: "parcial",
        percentual: 0,
        telefone: { ...abre().telefone, ehDeTeste: true },
      }).abre,
    ).toBe(true);
  });
});

describe("detectarRobo: sinais estruturais", () => {
  it.each([
    [{ texto: "oi", origem: "automacao" }, "origem_automacao"],
    [{ texto: "x".repeat(301) }, "texto_longo"],
    [{ texto: "Acesse https://exemplo.com para ver" }, "link"],
    [{ texto: "Veja em www.exemplo.com.br" }, "link"],
    [{ texto: "*Bem-vindo* ao nosso atendimento" }, "negrito_no_comeco"],
    [{ texto: "Digite 1 para falar com o atendimento" }, "frase_de_robo"],
    [{ texto: "Responda PARAR para sair" }, "frase_de_robo"],
    [{ texto: "Seu código de verificação é 99" }, "frase_de_robo"],
    [
      { texto: "Quero fazer um pedido grande agora", msDesdeNossoEnvio: 1200 },
      "resposta_rapida_demais",
    ],
    [
      {
        texto: "Quero um banner de lona grande",
        ultimaEntradaNormalizada: "quero um banner de lona grande",
      },
      "texto_repetido",
    ],
  ])("%j é robô (%s)", (a, motivo) => {
    expect(
      detectarRobo({ quadro: SEMENTES_DO_QUADRO, config: CONFIG_PADRAO_DA_TRIAGEM, ...a }),
    ).toEqual({ suspeito: true, motivo });
  });
  it.each([
    [{ texto: "sim", msDesdeNossoEnvio: 800 }],
    [{ texto: "Maria Souza", msDesdeNossoEnvio: 1500 }],
    [{ texto: "Quero um banner", msDesdeNossoEnvio: 20000 }],
    [{ texto: "sim", ultimaEntradaNormalizada: "sim" }],
    [{ texto: "Olá, vi o anúncio", origem: "cliente" }],
    [{ texto: "Quero um banner de 2x1", msDesdeNossoEnvio: -300 }],
  ])("%j é gente", (a) => {
    expect(
      detectarRobo({ quadro: SEMENTES_DO_QUADRO, config: CONFIG_PADRAO_DA_TRIAGEM, ...a }).suspeito,
    ).toBe(false);
  });
});
