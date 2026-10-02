import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  TITULO_DO_ERRO,
  abertosPorOs,
  avisoDeComecou,
  avisoDeClienteRetirou,
  avisoDeMandouParaAcabamento,
  avisoDeTerminou,
  caraDaMaquina,
  erroDeMaquina,
  horaDaOficina,
  minutosEmPalavras,
  avisoDeSoApontou,
  ondeEstaRodando,
  passosDaOs,
  portaDoApontamento,
  precisaAcertarStatus,
  situacaoDoBotao,
  textoDaOcupada,
  type ApontamentoAberto,
  type ComecouNaMaquina,
  type MaquinaParaComecar,
} from "../src/domain/os/comecar-na-maquina";
import { semDinheiro } from "../src/domain/os/bloqueio-sem-dinheiro";
import { STATUS, etapaDe } from "../src/domain/os/etapas";

/**
 * "COMEÇAR" ACENDE A MÁQUINA.
 *
 * O defeito que este módulo fecha: o botão "Começar" do painel do impressor
 * gravava só o status genérico `em_producao`. Nenhum apontamento abria — a
 * tabela tinha ZERO linhas na história em 01/10/2026 — e a TV da Oficina, que
 * só escreve RODANDO com apontamento aberto, nasceria toda SEM REGISTRO.
 *
 * Os valores de exemplo abaixo NÃO são inventados: são as respostas que o
 * banco deu no ensaio de 01/10/2026 (simulando o operador real, papel
 * `operador`, com OS de teste criadas e desfeitas no próprio ensaio). Se a
 * função do banco mudar o formato, o ensaio muda e estes exemplos também.
 */

// Meio-dia de 01/10/2026 em Macapá (UTC-3). Fixo: teste com "hoje" de verdade
// passa num dia e falha no outro.
const AGORA = new Date("2026-10-01T15:00:00Z");

const OPERADOR = { podeApontar: true, podeFinalizar: true };
// O gestor de hoje: `producao.read` e mais nada da produção.
const GESTOR = { podeApontar: false, podeFinalizar: false };

function maquina(parcial: Partial<MaquinaParaComecar> = {}): MaquinaParaComecar {
  return {
    id: "b77ec8f1-f336-4433-9b49-03c34db4183e",
    nome: "Plotter de Impressão i1600 180 — Eco",
    tipo: "plotter_impressao",
    ordem: 1,
    status_destino: "em_impressao",
    sugerida: false,
    ocupada: false,
    ocupada_por_os_numero: null,
    ocupada_por_esta_os: false,
    ocupada_desde: null,
    pode_comecar: true,
    ...parcial,
  };
}

describe("que passo o cartão oferece", () => {
  it("quem aponta: Começar abre os botões de máquina, não o status genérico", () => {
    const p = passosDaOs({ status: "aguardando_producao" }, OPERADOR);
    expect(p.principal).toEqual({ acao: "escolher_maquina", rotulo: "Começar" });
    expect(p.secundario).toBeNull();
    expect(p.impedimento).toBeNull();
  });

  it("na fila com máquina já apontada (pela ficha): o passo é pôr em produção, pela mesma folha", () => {
    // O beco medido em 01/10/2026: a ficha abre o apontamento sem mudar o
    // status; "Começar" ao lado de uma máquina que já roda não diz o que falta.
    const p = passosDaOs({ status: "aguardando_producao" }, OPERADOR, 1);
    expect(p.principal).toEqual({ acao: "escolher_maquina", rotulo: "Pôr em produção" });
    // Quem não aponta não ganha rótulo novo nem caminho novo.
    expect(passosDaOs({ status: "aguardando_producao" }, GESTOR, 1).principal).toEqual({
      acao: "avancar",
      rotulo: "Começar",
      destino: "em_producao",
    });
  });

  it("quem não aponta continua com o Começar de antes — o botão não some de ninguém", () => {
    const p = passosDaOs({ status: "aguardando_producao" }, GESTOR);
    expect(p.principal).toEqual({ acao: "avancar", rotulo: "Começar", destino: "em_producao" });
    expect(p.secundario).toBeNull();
  });

  it("em produção, o passo é mandar para o acabamento pela função atômica", () => {
    for (const status of [
      "em_producao",
      "producao",
      "em_impressao",
      "em_corte",
      "em_laser_cnc",
      "em_3d",
      "em_uv",
    ]) {
      expect(etapaDe(status), status).toBe("producao");
      expect(passosDaOs({ status }, OPERADOR, 1).principal, status).toEqual({
        acao: "mandar_para_acabamento",
        rotulo: "Mandar p/ acabamento",
      });
    }
  });

  it("em produção pelo caminho antigo (sem apontamento): oferece Dizer a máquina", () => {
    const p = passosDaOs({ status: "em_producao" }, OPERADOR, 0);
    expect(p.secundario).toEqual({ acao: "escolher_maquina", rotulo: "Dizer a máquina" });
  });

  it("já rodando: o secundário vira Outra máquina", () => {
    const p = passosDaOs({ status: "em_impressao" }, OPERADOR, 1);
    expect(p.secundario).toEqual({ acao: "escolher_maquina", rotulo: "Outra máquina" });
    expect(p.impedimento).toBeNull();
  });

  it("quem não aponta não ganha botão de máquina", () => {
    expect(passosDaOs({ status: "em_producao" }, GESTOR, 0).secundario).toBeNull();
  });

  it("quem não fecha apontamento e encontra a OS rodando lê o motivo antes do toque", () => {
    // O banco recusaria: `mandar_para_acabamento` com apontamento aberto exige
    // producao.finish ("Permissão necessária: producao.finish", medido).
    const rodando = passosDaOs({ status: "em_impressao" }, GESTOR, 1);
    expect(rodando.principal?.acao).toBe("mandar_para_acabamento");
    expect(rodando.impedimento).toMatch(/quem aponta/);
    // Sem apontamento aberto o banco só exige ser da equipe: nada impede.
    expect(passosDaOs({ status: "em_producao" }, GESTOR, 0).impedimento).toBeNull();
  });

  it("os outros passos continuam como eram", () => {
    expect(passosDaOs({ status: "em_acabamento" }, OPERADOR).principal).toEqual({
      acao: "avancar",
      rotulo: "Pronta",
      destino: "aguardando_retirada",
    });
    expect(passosDaOs({ status: "retrabalho", precisa_entrega: true }, OPERADOR).principal).toEqual(
      { acao: "avancar", rotulo: "Pronta", destino: "aguardando_entrega" },
    );
    expect(
      passosDaOs({ status: "em_acabamento", precisa_instalacao: true }, OPERADOR).principal,
    ).toEqual({ acao: "avancar", rotulo: "Pronta", destino: "em_instalacao" });
    expect(passosDaOs({ status: "aguardando_entrega" }, OPERADOR).principal).toBeNull();
  });

  it("'Cliente retirou' registra a retirada — não tenta concluir pela porta do administrador", () => {
    // Era `avancar_os_status(os,'concluido')`, que exige os.close: o operador
    // no balcão recebia "Permissão necessária: os.close" e a OS ficava como
    // "no balcão". Vale para quem aponta e para quem não aponta.
    for (const quem of [OPERADOR, GESTOR]) {
      expect(passosDaOs({ status: "aguardando_retirada" }, quem).principal).toEqual({
        acao: "cliente_retirou",
        rotulo: "Cliente retirou",
      });
    }
  });

  it("o aviso da retirada não diz que fechou quando só registrou", () => {
    const base = {
      os_id: "x",
      os_numero: 52,
      status_anterior: "aguardando_retirada",
      status: "aguardando_retirada",
      ja_estava_registrada: false,
      fechou: false,
      saiu_da_parede: true,
    };
    expect(avisoDeClienteRetirou(base).titulo).toBe("OS #52 retirada pelo cliente");
    expect(avisoDeClienteRetirou(base).descricao).toContain("administrador");
    expect(avisoDeClienteRetirou({ ...base, fechou: true, status: "concluido" }).titulo).toBe(
      "OS #52 retirada e fechada",
    );
    expect(avisoDeClienteRetirou({ ...base, ja_estava_registrada: true }).titulo).toContain(
      "já registrada",
    );
  });

  it("apontamento esquecido avisa que só o tempo até o teto virou custo", () => {
    const r = {
      os_id: "x",
      os_numero: 9,
      fechados: 1,
      apontamentos: [
        { apontamento_id: "a", maquina_id: "m", maquina_tipo: "laser_co2", minutos: 1200, passou_do_teto: true },
      ],
      status_anterior: "em_laser_cnc",
      status: "em_acabamento",
    };
    const aviso = avisoDeMandouParaAcabamento(r).descricao;
    expect(aviso).toContain("20h00");
    expect(aviso).toContain("só o tempo até lá virou custo");
    expect(aviso).not.toMatch(/R\$|\d+,\d{2}/);
    // Sem passar do teto, nenhuma frase a mais.
    const normal = avisoDeMandouParaAcabamento({
      ...r,
      apontamentos: [{ ...r.apontamentos[0], minutos: 42, passou_do_teto: false }],
    }).descricao;
    expect(normal).not.toContain("teto");
    expect(normal).not.toContain("fim do dia");
  });

  it("nenhum dos 26 status quebra, e destino de `avancar` é sempre status que existe", () => {
    const existentes = new Set(STATUS.map((s) => s.status));
    for (const { status } of STATUS) {
      for (const quem of [OPERADOR, GESTOR]) {
        const p = passosDaOs({ status }, quem, 0);
        if (p.principal?.acao === "avancar") {
          expect(existentes.has(p.principal.destino), `${status} → ${p.principal.destino}`).toBe(
            true,
          );
        }
      }
    }
    expect(passosDaOs({ status: "status_que_nao_existe" }, OPERADOR).principal).toBeNull();
  });
});

describe("a hora é a do relógio da oficina", () => {
  it("bate com o `iniciado_local` que o banco devolveu no ensaio", () => {
    // comecar_na_maquina devolveu iniciado_em 22:35:54 UTC e iniciado_local "19:35".
    expect(horaDaOficina("2026-10-01T22:35:54.6355+00:00", new Date("2026-10-01T22:40:00Z"))).toBe(
      "19:35",
    );
  });

  it("apontamento que ficou de um dia para o outro mostra o dia", () => {
    // 02:30 UTC de 01/10 ainda é 23:30 de 30/09 em Macapá.
    expect(horaDaOficina("2026-10-01T02:30:00Z", AGORA)).toBe("30/09 23:30");
    // 03:10 UTC já é 00:10 de 01/10 — hoje.
    expect(horaDaOficina("2026-10-01T03:10:00Z", AGORA)).toBe("00:10");
  });

  it("valor vazio ou inválido não vira hora", () => {
    expect(horaDaOficina(null, AGORA)).toBeNull();
    expect(horaDaOficina("", AGORA)).toBeNull();
    expect(horaDaOficina("ontem", AGORA)).toBeNull();
  });

  it("minutos do jeito que a oficina fala", () => {
    expect(minutosEmPalavras(0)).toBe("0 min");
    expect(minutosEmPalavras(42)).toBe("42 min");
    expect(minutosEmPalavras(65)).toBe("1h05");
    expect(minutosEmPalavras(-3)).toBe("0 min");
    expect(minutosEmPalavras(Number.NaN)).toBe("0 min");
  });
});

describe("os botões de máquina", () => {
  it("o nome curto vem do tipo — é o que a parede escreve", () => {
    expect(caraDaMaquina({ tipo: "plotter_impressao", nome: "Plotter i1600" }).curto).toBe(
      "Impressão",
    );
    expect(caraDaMaquina({ tipo: "plotter_recorte" }).curto).toBe("Recorte");
    expect(caraDaMaquina({ tipo: "laser_co2" }).curto).toBe("Laser CO2");
    expect(caraDaMaquina({ tipo: "laser_fiber" }).curto).toBe("Fiber");
    expect(caraDaMaquina({ tipo: "impressora_3d" }).curto).toBe("3D");
  });

  it("tipo fora do mapa não some: cai no genérico com o nome cadastrado", () => {
    const cara = caraDaMaquina({ tipo: "router_cnc", nome: "Router 1325" });
    expect(cara.curto).toBe("Router 1325");
    expect(cara.icone).toBe("Factory");
    expect(caraDaMaquina({ tipo: null, nome: null }).curto).toBe("Máquina");
    // `tipo` é texto livre: palavra herdada de Object.prototype não pode
    // devolver uma função no lugar da identidade.
    expect(caraDaMaquina({ tipo: "constructor", nome: "X" }).curto).toBe("X");
  });

  it('ocupada diz COM O QUÊ e desde quando: "OS #90 desde 14:32"', () => {
    expect(
      textoDaOcupada(
        {
          ocupada: true,
          ocupada_por_os_numero: 90,
          ocupada_por_esta_os: false,
          ocupada_desde: "2026-10-01T17:32:00Z",
        },
        AGORA,
      ),
    ).toBe("OS #90 desde 14:32");
  });

  it("ocupada desde ontem mostra o dia — é a que ninguém fechou", () => {
    expect(
      textoDaOcupada(
        {
          ocupada: true,
          ocupada_por_os_numero: 90,
          ocupada_por_esta_os: false,
          ocupada_desde: "2026-09-30T20:00:00Z",
        },
        AGORA,
      ),
    ).toBe("OS #90 desde 30/09 17:00");
  });

  it("ocupada pela própria OS e ocupada sem OS têm frase própria", () => {
    expect(
      textoDaOcupada(
        {
          ocupada: true,
          ocupada_por_os_numero: 99,
          ocupada_por_esta_os: true,
          ocupada_desde: "2026-10-01T13:05:00Z",
        },
        AGORA,
      ),
    ).toBe("Esta OS já roda aqui desde 10:05");
    expect(
      textoDaOcupada(
        {
          ocupada: true,
          ocupada_por_os_numero: null,
          ocupada_por_esta_os: false,
          ocupada_desde: "2026-10-01T13:05:00Z",
        },
        AGORA,
      ),
    ).toBe("Ocupada desde 10:05");
    expect(
      textoDaOcupada(
        {
          ocupada: true,
          ocupada_por_os_numero: 7,
          ocupada_por_esta_os: false,
          ocupada_desde: null,
        },
        AGORA,
      ),
    ).toBe("OS #7");
  });

  it("máquina livre não tem texto de ocupada", () => {
    expect(textoDaOcupada(maquina(), AGORA)).toBeNull();
  });

  it("quem decide se pode tocar é o banco (`pode_comecar`); a tela só escolhe a frase", () => {
    expect(situacaoDoBotao(maquina(), false, AGORA)).toEqual({
      habilitado: true,
      motivo: null,
      acerto: false,
    });

    expect(
      situacaoDoBotao(
        maquina({
          ocupada: true,
          ocupada_por_os_numero: 99,
          ocupada_desde: "2026-10-01T14:35:00Z",
          pode_comecar: false,
        }),
        false,
        AGORA,
      ),
    ).toEqual({ habilitado: false, motivo: "OS #99 desde 11:35", acerto: false });

    expect(
      situacaoDoBotao(maquina({ status_destino: null, pode_comecar: false }), false, AGORA),
    ).toEqual({
      habilitado: false,
      motivo: "Sem etapa no sistema — avise o gestor",
      acerto: false,
    });

    expect(situacaoDoBotao(maquina({ pode_comecar: false }), true, AGORA)).toEqual({
      habilitado: false,
      motivo: "OS já encerrada",
      acerto: false,
    });
  });

  // A resposta de maquinas_para_comecar no ensaio do beco: OS de teste em
  // aguardando_producao, apontada no Recorte pela ficha (iniciar_apontamento).
  const RECORTE_DESTA_OS = maquina({
    id: "e2c92d0d-3b74-4240-8633-5428ff00dfc3",
    tipo: "plotter_recorte",
    status_destino: "em_corte",
    ocupada: true,
    ocupada_por_esta_os: true,
    ocupada_por_os_numero: 9201,
    ocupada_desde: "2026-10-01T14:35:00Z",
    pode_comecar: false,
  });

  it("OS apontada pela ficha e ainda na fila: falta o status alcançar o apontamento", () => {
    expect(
      precisaAcertarStatus({
        os_status: "aguardando_producao",
        os_encerrada: false,
        maquinas: [maquina(), RECORTE_DESTA_OS],
      }),
    ).toBe(true);
    // Em produção genérica (Kanban) com máquina aberta: também falta acertar.
    expect(
      precisaAcertarStatus({
        os_status: "em_producao",
        os_encerrada: false,
        maquinas: [RECORTE_DESTA_OS],
      }),
    ).toBe(true);
  });

  it("status já é o de uma das máquinas abertas: nada a acertar — nem com a OS em duas", () => {
    expect(
      precisaAcertarStatus({
        os_status: "em_corte",
        os_encerrada: false,
        maquinas: [RECORTE_DESTA_OS],
      }),
    ).toBe(false);
    // Aberta na Impressão e no Recorte, status da Impressão: tocar no Recorte
    // NÃO pode trocar o status de lugar (o banco responde ja_rodando_aqui).
    const impressaoDestaOs = maquina({
      ocupada: true,
      ocupada_por_esta_os: true,
      pode_comecar: false,
    });
    expect(
      precisaAcertarStatus({
        os_status: "em_impressao",
        os_encerrada: false,
        maquinas: [impressaoDestaOs, RECORTE_DESTA_OS],
      }),
    ).toBe(false);
    // Sem máquina aberta, ou OS encerrada: não há o que acertar.
    expect(
      precisaAcertarStatus({
        os_status: "em_producao",
        os_encerrada: false,
        maquinas: [maquina()],
      }),
    ).toBe(false);
    expect(
      precisaAcertarStatus({
        os_status: "concluido",
        os_encerrada: true,
        maquinas: [RECORTE_DESTA_OS],
      }),
    ).toBe(false);
  });

  it("a máquina em que a OS já roda fica tocável SÓ para acertar o status", () => {
    expect(situacaoDoBotao(RECORTE_DESTA_OS, false, AGORA, true)).toEqual({
      habilitado: true,
      motivo: "Esta OS já roda aqui desde 11:35 — toque para acertar o status",
      acerto: true,
    });
    // Sem nada a acertar continua desabilitada, com o motivo de antes.
    expect(situacaoDoBotao(RECORTE_DESTA_OS, false, AGORA, false)).toEqual({
      habilitado: false,
      motivo: "Esta OS já roda aqui desde 11:35",
      acerto: false,
    });
    // Máquina de OUTRA OS nunca vira tocável por causa do acerto.
    const deOutra = maquina({ ocupada: true, ocupada_por_os_numero: 90, pode_comecar: false });
    expect(situacaoDoBotao(deOutra, false, AGORA, true).habilitado).toBe(false);
    // OS encerrada também não.
    expect(situacaoDoBotao(RECORTE_DESTA_OS, true, AGORA, true).habilitado).toBe(false);
  });

  it("botão desabilitado nunca fica sem motivo escrito", () => {
    const casos = [
      maquina({ pode_comecar: false }),
      maquina({ pode_comecar: false, ocupada: true }),
      maquina({ pode_comecar: false, status_destino: null }),
    ];
    for (const m of casos) {
      for (const encerrada of [true, false]) {
        const s = situacaoDoBotao(m, encerrada, AGORA);
        expect(s.habilitado).toBe(false);
        expect(s.motivo, JSON.stringify(m)).toBeTruthy();
      }
    }
  });
});

describe("em que máquina a OS está", () => {
  const abertos: ApontamentoAberto[] = [
    {
      id: "a2",
      os_id: "os-1",
      maquina_id: "m-rec",
      iniciado_em: "2026-10-01T14:10:00Z",
      maquinas: { nome: "Plotter de Recorte 120", tipo: "plotter_recorte" },
    },
    {
      id: "a1",
      os_id: "os-1",
      maquina_id: "m-imp",
      iniciado_em: "2026-10-01T13:00:00Z",
      maquinas: { nome: "Plotter i1600", tipo: "plotter_impressao" },
    },
    {
      id: "a3",
      os_id: "os-2",
      maquina_id: "m-3d",
      iniciado_em: "2026-09-30T19:00:00Z",
      maquinas: { nome: "Bambu Lab A1", tipo: "impressora_3d" },
    },
    // Apontamento avulso, sem OS: não é de cartão nenhum.
    {
      id: "a4",
      os_id: null,
      maquina_id: "m-co2",
      iniciado_em: "2026-10-01T12:00:00Z",
      maquinas: null,
    },
  ];

  it("agrupa por OS, do mais antigo para o mais novo, e ignora o que não tem OS", () => {
    const mapa = abertosPorOs(abertos);
    expect([...mapa.keys()].sort()).toEqual(["os-1", "os-2"]);
    expect(mapa.get("os-1")!.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("escreve máquina e hora — e duas linhas quando a OS está aberta em duas", () => {
    const linhas = ondeEstaRodando(abertosPorOs(abertos).get("os-1")!, AGORA);
    expect(linhas.map((l) => `${l.maquina.curto} desde ${l.desde}`)).toEqual([
      "Impressão desde 10:00",
      "Recorte desde 11:10",
    ]);
    // Cada linha leva a SUA máquina: é o que o "Terminei" daquela linha manda.
    expect(linhas.map((l) => l.maquina_id)).toEqual(["m-imp", "m-rec"]);
    const deOntem = ondeEstaRodando(abertosPorOs(abertos).get("os-2")!, AGORA);
    expect(`${deOntem[0].maquina.curto} desde ${deOntem[0].desde}`).toBe("3D desde 30/09 16:00");
  });

  it("máquina apagada do cadastro (embed nulo) não derruba o cartão", () => {
    const [linha] = ondeEstaRodando([abertos[3]], AGORA);
    expect(linha.maquina.curto).toBe("Máquina");
  });
});

describe("o que dizer depois do toque", () => {
  // Resposta real de comecar_na_maquina no ensaio (OS de teste #99).
  const comecou: ComecouNaMaquina = {
    apontamento_id: "a1a8eb39-768d-4748-8c6b-8e85a2046703",
    os_id: "os",
    os_numero: 99,
    maquina_id: "b77ec8f1-f336-4433-9b49-03c34db4183e",
    maquina_tipo: "plotter_impressao",
    maquina_nome: "Plotter de Impressão i1600 180 — Eco",
    status_anterior: "aguardando_producao",
    status: "em_impressao",
    etapa: "Impressão",
    agenda_id: null,
    iniciado_em: "2026-10-01T22:35:54.6355+00:00",
    iniciado_local: "19:35",
    outras_maquinas_abertas: [],
  };

  it("começou: OS, máquina e hora", () => {
    expect(avisoDeComecou(comecou)).toEqual({
      titulo: "OS #99 rodando · Impressão desde 19:35",
      descricao: null,
    });
  });

  it("começou em outra com a primeira aberta: avisa que a primeira continua ocupada", () => {
    const aviso = avisoDeComecou({
      ...comecou,
      maquina_tipo: "plotter_recorte",
      status: "em_corte",
      outras_maquinas_abertas: [
        { apontamento_id: "x", maquina_id: "m", maquina_tipo: "plotter_impressao" },
      ],
    });
    expect(aviso.titulo).toBe("OS #99 rodando · Recorte desde 19:35");
    // Diz ONDE se termina: a primeira versão mandava "terminar lá" e não havia
    // botão "lá" — só um que fechava as duas máquinas.
    expect(aviso.descricao).toBe(
      "Continua aberta também em: Impressão. Quando parar lá, toque em Outra máquina e em Terminei.",
    );
  });

  it("acertou o status de uma OS que já rodava: não diz que começou agora", () => {
    // Resposta do ensaio: apontamento aberto pela ficha, OS em aguardando_producao.
    const aviso = avisoDeComecou(
      {
        ...comecou,
        os_numero: 9201,
        maquina_tipo: "plotter_recorte",
        status_anterior: "aguardando_producao",
        status: "em_corte",
        iniciado_em: "2026-09-30T20:00:00Z",
        iniciado_local: "17:00",
        ja_estava_rodando: true,
      },
      AGORA,
    );
    // A hora é a do início de verdade — com o dia, porque ficou de ontem.
    expect(aviso.titulo).toBe("OS #9201 em produção · Recorte desde 30/09 17:00");
    expect(aviso.descricao).toBe("A máquina já estava apontada; o status da OS foi acertado.");
  });

  it("mandou para o acabamento: diz o tempo que ficou registrado", () => {
    expect(
      avisoDeMandouParaAcabamento({
        os_id: "os",
        os_numero: 99,
        status_anterior: "em_corte",
        status: "em_acabamento",
        fechados: 2,
        apontamentos: [
          { apontamento_id: "a", maquina_id: "m1", maquina_tipo: "plotter_impressao", minutos: 42 },
          { apontamento_id: "b", maquina_id: "m2", maquina_tipo: "plotter_recorte", minutos: 65 },
        ],
      }),
    ).toEqual({
      titulo: "OS #99 → Acabamento",
      descricao: "Tempo de máquina registrado: Impressão 42 min · Recorte 1h05.",
    });
  });

  // A resposta de mandar_para_acabamento DEPOIS de "Terminei" (ensaio de
  // 01/10/2026): fechados 0 — e a OS com 2 apontamentos finalizados na tabela.
  const SEM_ABERTO = {
    os_id: "os",
    os_numero: 9201,
    status_anterior: "em_impressao",
    status: "em_acabamento",
    fechados: 0,
    apontamentos: [],
  };

  it("mandou depois de Terminei: o tempo JÁ estava registrado — não dizer que se perdeu", () => {
    // Era o defeito: a frase "o tempo de máquina desta OS não ficou registrado"
    // saía justamente no fluxo que a folha ensina, e quem lê aponta de novo.
    const aviso = avisoDeMandouParaAcabamento(SEM_ABERTO, 2);
    expect(aviso.descricao).toBe(
      "Nenhuma máquina estava aberta agora — o tempo já tinha ficado registrado (2 apontamentos).",
    );
    expect(avisoDeMandouParaAcabamento(SEM_ABERTO, 1).descricao).toContain("(1 apontamento)");
  });

  it("mandou sem NENHUM apontamento na história da OS: aí sim, não há tempo", () => {
    expect(avisoDeMandouParaAcabamento(SEM_ABERTO, 0).descricao).toBe(
      "Esta OS passou pela produção sem máquina apontada: não há tempo registrado.",
    );
  });

  it("sem conseguir contar, o aviso só diz o que a resposta prova", () => {
    for (const semContagem of [null, undefined]) {
      const { descricao } = avisoDeMandouParaAcabamento(SEM_ABERTO, semContagem);
      expect(descricao).toBe("Nenhuma máquina estava aberta nesta OS agora.");
      expect(descricao).not.toMatch(/registrad/);
    }
  });

  it("com máquina fechada no toque, a contagem não muda a frase", () => {
    const fechou = {
      ...SEM_ABERTO,
      fechados: 1,
      apontamentos: [
        { apontamento_id: "a", maquina_id: "m", maquina_tipo: "plotter_impressao", minutos: 42 },
      ],
    };
    expect(avisoDeMandouParaAcabamento(fechou, null).descricao).toBe(
      "Tempo de máquina registrado: Impressão 42 min.",
    );
  });

  it("terminou só uma máquina: diz o tempo e o que CONTINUA rodando", () => {
    // Resposta de terminar_so_esta_maquina no ensaio: fechou o Recorte, a
    // Impressão continuou aberta.
    expect(
      avisoDeTerminou({
        os_id: "os",
        os_numero: 9201,
        maquina_id: "e2c92d0d-3b74-4240-8633-5428ff00dfc3",
        maquina_tipo: "plotter_recorte",
        fechados: 1,
        apontamentos: [
          { apontamento_id: "a", maquina_id: "m", maquina_tipo: "plotter_recorte", minutos: 8 },
        ],
        continuam_abertas: [
          { apontamento_id: "b", maquina_id: "i", maquina_tipo: "plotter_impressao" },
        ],
      }),
    ).toEqual({
      titulo: "OS #9201 · máquina liberada",
      descricao: "Tempo registrado: Recorte 8 min. Continua rodando em: Impressão.",
    });
  });

  it("terminou a última: libera, e o status fica onde estava", () => {
    expect(
      avisoDeTerminou({
        os_id: "os",
        os_numero: 99,
        maquina_id: "m",
        maquina_tipo: "laser_fiber",
        fechados: 1,
        apontamentos: [
          { apontamento_id: "a", maquina_id: "m", maquina_tipo: "laser_fiber", minutos: 8 },
        ],
        continuam_abertas: [],
      }),
    ).toEqual({
      titulo: "OS #99 · máquina liberada",
      descricao: "Tempo registrado: Fiber 8 min. O status da OS não mudou.",
    });
  });

  it("nada para terminar: diz que a tela estava velha, sem inventar tempo", () => {
    const umaSo = avisoDeTerminou({
      os_id: "os",
      os_numero: 99,
      maquina_id: "m",
      maquina_tipo: "plotter_recorte",
      fechados: 0,
      apontamentos: [],
      continuam_abertas: [],
    });
    expect(umaSo.titulo).toBe("OS #99 · nada para terminar");
    expect(umaSo.descricao).toBe(
      "Esta OS não estava aberta em Recorte — outra pessoa já terminou.",
    );
    // A função que fecha tudo (usada por dentro do "Mandar p/ acabamento").
    expect(
      avisoDeTerminou({ os_id: "os", os_numero: 99, fechados: 0, apontamentos: [] }).descricao,
    ).toBe("Não havia apontamento aberto nesta OS.");
  });

  it("nenhum aviso carrega dinheiro", () => {
    const textos = [
      avisoDeComecou(comecou),
      avisoDeMandouParaAcabamento({
        os_id: "os",
        os_numero: 1,
        status_anterior: "em_corte",
        status: "em_acabamento",
        fechados: 1,
        apontamentos: [
          { apontamento_id: "a", maquina_id: "m", maquina_tipo: "laser_co2", minutos: 5 },
        ],
      }),
      avisoDeMandouParaAcabamento(SEM_ABERTO, 2),
      avisoDeMandouParaAcabamento(SEM_ABERTO, 0),
      avisoDeMandouParaAcabamento(SEM_ABERTO, null),
      avisoDeSoApontou("em_impressao"),
    ].map((a) => `${a.titulo} ${a.descricao ?? ""}`);
    for (const t of textos) expect(t).not.toMatch(/R\$|custo|margem|valor/i);
  });
});

describe("a ficha da OS: por qual porta o Iniciar produção entra", () => {
  it("OS na fila ou em produção, sem etapa escolhida: a mesma porta do Começar", () => {
    for (const status of [
      "aguardando_producao",
      "em_producao",
      "em_impressao",
      "em_corte",
      "em_3d",
    ]) {
      expect(portaDoApontamento(status, null), status).toBe("comecar");
      expect(portaDoApontamento(status, ""), status).toBe("comecar");
    }
  });

  it("com etapa escolhida, só o tempo é apontado — Laminação não diz em que máquina a OS está", () => {
    expect(portaDoApontamento("aguardando_producao", "Laminação")).toBe("so_apontar");
    expect(portaDoApontamento("em_impressao", "Recorte")).toBe("so_apontar");
  });

  it("fora da fila e da produção, ou sem saber o status: a porta que NÃO mexe em status", () => {
    // Levar para a máquina uma OS que já está no acabamento seria andar para
    // trás sem ninguém pedir.
    for (const status of ["em_acabamento", "retrabalho", "design", "arte_aprovada", "concluido"]) {
      expect(portaDoApontamento(status, null), status).toBe("so_apontar");
    }
    expect(portaDoApontamento(null, null)).toBe("so_apontar");
    expect(portaDoApontamento(undefined, null)).toBe("so_apontar");
    expect(portaDoApontamento("status_que_nao_existe", null)).toBe("so_apontar");
  });

  it("quando só o tempo foi apontado, o aviso diz que o status não mudou", () => {
    expect(avisoDeSoApontou("aguardando_producao")).toEqual({
      titulo: "Tempo de máquina apontado",
      descricao: "O status da OS não mudou: continua em Fila de produção.",
    });
    expect(avisoDeSoApontou(null).descricao).toBe("O status da OS não mudou.");
  });
});

describe("o erro, em português e sem dinheiro", () => {
  const OPERACIONAL = { canSeeFinancials: false, canSeePrices: false };

  it("erro com código: a frase do banco passa como está, com título do código", () => {
    // Texto e código exatamente como voltaram no ensaio.
    const e = erroDeMaquina(
      {
        code: "P0001",
        message:
          "A máquina Plotter de Impressão i1600 180 — Eco está ocupada com a OS #99. Termine lá antes de começar outra.",
        details: "maquina_ocupada",
        hint: null,
      },
      OPERACIONAL,
    );
    expect(e).toEqual({
      codigo: "maquina_ocupada",
      titulo: "Máquina ocupada",
      descricao:
        "A máquina Plotter de Impressão i1600 180 — Eco está ocupada com a OS #99. Termine lá antes de começar outra.",
      listaMudou: true,
    });
  });

  it("o código NÃO aparece no texto mostrado", () => {
    // O tradutor geral junta message e details ("… · ja_rodando_aqui").
    const e = erroDeMaquina({
      code: "P0001",
      message: "A OS #99 já está rodando nesta máquina desde 01/10 19:35.",
      details: "ja_rodando_aqui",
    });
    expect(`${e.titulo} ${e.descricao}`).not.toContain("ja_rodando_aqui");
    expect(e.listaMudou).toBe(true);
  });

  it("todos os códigos da migração têm título, e nenhum título é o próprio código", () => {
    // As duas migrações que levantam erro com código para esta tela.
    const daMigracao = [
      "supabase/migrations/20261001110000_comecar_na_maquina.sql",
      "supabase/migrations/20261001150000_terminar_so_uma_maquina_e_acertar_o_status.sql",
    ]
      .map((arquivo) => readFileSync(arquivo, "utf8"))
      .join("\n");
    const codigos = [
      ...new Set([...daMigracao.matchAll(/using detail = '([a-z_]+)'/g)].map((m) => m[1])),
    ];
    // O teste não pode passar por não achar nada.
    expect(codigos.length).toBeGreaterThanOrEqual(9);
    for (const c of codigos) {
      const e = erroDeMaquina({ message: "Mensagem do banco.", details: c });
      expect(e.codigo, `código ${c} sem título em TITULO_DO_ERRO`).toBe(c);
      expect(e.titulo).not.toContain("_");
    }
    expect(Object.keys(TITULO_DO_ERRO).sort()).toEqual([...codigos].sort());
  });

  it("só pede para recarregar os botões quando a lista ficou velha", () => {
    const mudou = (c: string) => erroDeMaquina({ message: "x", details: c }).listaMudou;
    expect(mudou("maquina_ocupada")).toBe(true);
    expect(mudou("ja_rodando_aqui")).toBe(true);
    expect(mudou("maquina_inativa")).toBe(true);
    expect(mudou("os_encerrada")).toBe(true);
    expect(mudou("quantidade_invalida")).toBe(false);
    expect(mudou("maquina_sem_status")).toBe(false);
  });

  // A frase exata que comecar_na_maquina devolveu ao operador no ensaio, numa
  // OS de teste com margem de 5%.
  const TRAVADA = {
    code: "P0001",
    message:
      "A OS não pode avançar ainda: Nenhum pagamento registrado; Arte ainda não aprovada; Sem arquivo final de produção; Margem de 5.00% abaixo do mínimo de 20.00%.",
    details: null,
  };

  it("trava do Kanban vira lista — e o operador NÃO lê a margem", () => {
    const e = erroDeMaquina(TRAVADA, OPERACIONAL);
    expect(e.codigo).toBe("travada");
    expect(e.titulo).toBe("A OS ainda não pode avançar");
    expect(e.descricao).toBe(
      "Nenhum pagamento registrado · Arte ainda não aprovada · Sem arquivo final de produção · Margem abaixo do mínimo — precisa de aprovação do gestor",
    );
    expect(e.descricao).not.toMatch(/\d/);
  });

  it("sem dizer quem está olhando, vale a visão mais restrita", () => {
    expect(erroDeMaquina(TRAVADA).descricao).not.toContain("5.00%");
  });

  it("quem vê custo lê a margem; quem vê só preço lê o desconto e não a margem", () => {
    expect(
      erroDeMaquina(TRAVADA, { canSeeFinancials: true, canSeePrices: true }).descricao,
    ).toContain("Margem de 5.00% abaixo do mínimo de 20.00%");

    const comDesconto = {
      message:
        "A OS não pode avançar ainda: Margem de 12% abaixo do mínimo de 20%; Desconto de 15% acima do limite de 10%.",
    };
    const comercial = erroDeMaquina(comDesconto, { canSeeFinancials: false, canSeePrices: true });
    expect(comercial.descricao).toContain("Desconto de 15% acima do limite de 10%");
    expect(comercial.descricao).not.toContain("12%");
    const operacional = erroDeMaquina(comDesconto, OPERACIONAL);
    expect(operacional.descricao).not.toMatch(/\d/);
  });

  it("o corte diz o mesmo que `semDinheiro` diz no cartão — uma frase só para o mesmo fato", () => {
    const noCartao = (codigo: string, titulo: string) =>
      semDinheiro({ codigo, titulo, resolver: "" }, false, false).titulo;
    const noErro = erroDeMaquina(
      {
        message:
          "A OS não pode avançar ainda: Margem de 12% abaixo do mínimo de 20%; Desconto de 15% acima do limite de 10%.",
      },
      OPERACIONAL,
    ).descricao;
    expect(noErro).toBe(
      [
        noCartao("margem_baixa", "Margem de 12% abaixo do mínimo de 20%"),
        noCartao("desconto_alto", "Desconto de 15% acima do limite de 10%"),
      ].join(" · "),
    );
  });

  it("permissão: diz o que falta em palavras, e a quem pedir", () => {
    const start = erroDeMaquina({
      code: "P0001",
      message: "Permissão necessária: producao.start",
      details: null,
    });
    expect(start.codigo).toBe("sem_permissao");
    expect(start.descricao).toBe(
      "Falta a permissão de iniciar produção na máquina. Peça ao gestor.",
    );
    const finish = erroDeMaquina({ message: "Permissão necessária: producao.finish" });
    expect(finish.descricao).toContain("encerrar produção na máquina");
  });

  it("o que não reconhece passa pelo tradutor geral, sem inventar", () => {
    expect(erroDeMaquina({ message: "Failed to fetch" }).titulo).toBe(
      "Falha de conexão. Verifique sua internet e tente novamente.",
    );
    expect(
      erroDeMaquina({ code: "42501", message: "Usuário sem permissão para alterar status de OS." })
        .titulo,
    ).toBe("Usuário sem permissão para alterar status de OS.");
    expect(erroDeMaquina(new Error("Máquina não encontrada")).titulo).toBe(
      "Máquina não encontrada",
    );
    expect(erroDeMaquina(null).codigo).toBe("outro");
  });

  it("details com palavra herdada de Object não vira código", () => {
    expect(erroDeMaquina({ message: "Erro é erro.", details: "constructor" }).codigo).toBe("outro");
  });
});

/**
 * Quem aponta não vê custo — conferido no FONTE, porque `supabase as any`
 * apaga o tipo e nenhum compilador acusa um `custo_hora` a mais no select.
 */
describe("o painel e o cartão de apontamento não mostram custo a quem aponta", () => {
  /** Tira comentários: eles citam R$/h justamente para explicar a regra. */
  function semComentarios(fonte: string): string {
    return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("o painel do impressor e os botões de máquina não pedem nem formatam dinheiro", () => {
    for (const arquivo of [
      "src/components/painel/PainelProducao.tsx",
      "src/components/painel/SeletorDeMaquina.tsx",
      "src/domain/os/comecar-na-maquina.ts",
    ]) {
      const fonte = semComentarios(readFileSync(arquivo, "utf8"));
      expect(fonte, arquivo).not.toMatch(/custo_hora|valor_total|custo_previsto|custo_real/);
      expect(fonte, arquivo).not.toMatch(/currency|R\$/);
    }
  });

  it("a folha termina UMA máquina por vez — nunca todas as da OS de uma vez", () => {
    // Era o defeito: `terminar_na_maquina(os)` fecha tudo o que a OS tem
    // aberto, inclusive a máquina que ainda está rodando.
    const folha = semComentarios(
      readFileSync("src/components/painel/SeletorDeMaquina.tsx", "utf8"),
    );
    expect(folha).toContain('"terminar_so_esta_maquina"');
    expect(folha).not.toContain('"terminar_na_maquina"');
  });

  it("a folha só diz `Nenhuma máquina` com a resposta na mão", () => {
    // Fechando, a consulta fica desligada e sem dado: cair no ramo de lista
    // vazia escrevia "Nenhuma máquina ativa" logo depois de um Começar certo.
    const folha = semComentarios(
      readFileSync("src/components/painel/SeletorDeMaquina.tsx", "utf8"),
    );
    expect(folha).toMatch(/!dados \? null : maquinas\.length === 0/);
  });

  it("o painel lê o erro de TODA consulta — nenhuma desestruturação que jogue o erro fora", () => {
    for (const arquivo of [
      "src/components/painel/PainelProducao.tsx",
      "src/components/painel/SeletorDeMaquina.tsx",
    ]) {
      const fonte = semComentarios(readFileSync(arquivo, "utf8"));
      // `const { data: x = ... } = useAlgo()` é a forma que esconde a falha.
      expect(fonte, arquivo).not.toMatch(/const \{ data(?::| =|,| \})[^;]*\} = use[A-Z]/);
    }
    const painel = semComentarios(readFileSync("src/components/painel/PainelProducao.tsx", "utf8"));
    expect(painel).toContain("travas.isError");
  });

  it("a ficha da OS entra pela porta do Começar e fecha cada máquina aberta", () => {
    const ficha = semComentarios(readFileSync("src/components/os/apontamento-card.tsx", "utf8"));
    expect(ficha).toContain('"comecar_na_maquina"');
    expect(ficha).toContain("portaDoApontamento(");
    // Mostrava só o aberto MAIS NOVO (`find` numa lista do mais novo para o
    // mais antigo): fechava primeiro a máquina que continuava rodando.
    expect(ficha).not.toMatch(/\.find\(\(a\) => !a\.finalizado_em\)/);
    // Quem não vê custo fecha pela função que não devolve custo.
    expect(ficha).toMatch(/!canSeeFinancials && a\.maquina_id/);
    expect(ficha).toContain('"terminar_so_esta_maquina"');
  });

  it("apontamento-card só pede `custo_hora` depois de conferir o nível de visão", () => {
    const linhas = semComentarios(
      readFileSync("src/components/os/apontamento-card.tsx", "utf8"),
    ).split("\n");
    // Entre aspas duplas = lista de colunas de um select. (Crase é o texto
    // "R$/h" da tela, que o teste seguinte confere.)
    const emTexto = linhas.filter((l) => /"[^"]*custo_hora[^"]*"/.test(l));
    // O teste não pode passar por não achar nada: são duas consultas.
    expect(emTexto.length).toBe(2);
    for (const l of emTexto) {
      expect(l, `consulta pede custo_hora sem conferir canSeeFinancials:\n${l}`).toMatch(
        /canSeeFinancials\s*\?/,
      );
    }
  });

  it("apontamento-card não escreve valor em reais fora de um ramo de quem vê custo", () => {
    const fonte = semComentarios(readFileSync("src/components/os/apontamento-card.tsx", "utf8"));
    // Cada uso de brl( precisa estar a poucas linhas de um `canSeeFinancials`.
    const linhas = fonte.split("\n");
    const usos = linhas.map((l, i) => (l.includes("brl(") ? i : -1)).filter((i) => i >= 0);
    expect(usos.length).toBeGreaterThan(0);
    for (const i of usos) {
      const vizinhanca = linhas.slice(Math.max(0, i - 12), i + 1).join("\n");
      expect(vizinhanca, `linha ${i + 1}: ${linhas[i].trim()}`).toMatch(/canSeeFinancials/);
    }
  });
});
