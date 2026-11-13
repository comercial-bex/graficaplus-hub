import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { HORARIO_SEMENTE, PASSOS_SEMENTE, SEMENTES_DO_QUADRO } from "../../src/domain/whatsapp/triagem";

/**
 * A tela do robô de boas-vindas renderiza com dados de verdade (as sementes), em cada degrau da escada, e o
 * que o dono precisa ver está na tela: o botão grande, o vermelho Desligar tudo e o simulador sem envio.
 * Roda no servidor (renderToStaticMarkup), sem navegador e sem banco.
 */

vi.mock("@tanstack/react-start", async (original) => {
  const real = await original<typeof import("@tanstack/react-start")>();
  return { ...real, useServerFn: (f: unknown) => f };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { PainelDeLiga } from "../../src/components/triagem/painel-de-liga";
import { TextosDasEtapas } from "../../src/components/triagem/textos-das-etapas";
import { QuadroDeRespostas } from "../../src/components/triagem/quadro-de-respostas";
import { HorariosEFeriados } from "../../src/components/triagem/horarios-e-feriados";
import { Simulador } from "../../src/components/triagem/simulador";
import type { PainelDaTriagem } from "../../src/lib/api/whatsapp-triagem.functions";

function painel(o: Partial<PainelDaTriagem["config"]> = {}, p: Partial<PainelDaTriagem> = {}): PainelDaTriagem {
  return {
    config: {
      estado: "desligada",
      percentual: 0,
      numeros_teste: [],
      vale_a_partir_de: null,
      link_parceiro: null,
      avisar_grupo: true,
      agente_apos_triagem: false,
      espera_resposta_min: 30,
      retomar_ate_horas: 24,
      intervalo_minimo_s: 20,
      max_mensagens: 8,
      max_tentativas_por_passo: 2,
      max_novas_por_hora: 12,
      max_novas_por_dia: 60,
      atraso_min_s: 3,
      atraso_max_s: 8,
      freio_falhas_envio: 3,
      freio_erros_hora: 10,
      desligada_por: null,
      desligada_em: null,
      atualizado_em: null,
      ...o,
    },
    podeLigar: true,
    podeEditar: true,
    passos: PASSOS_SEMENTE.map((x, i) => ({
      codigo: x.codigo,
      ramo: x.ramo,
      ordem: i,
      texto: x.texto,
      variantes: [...(x.variantes ?? [])],
      repeticao: x.repeticao ?? null,
      ajuda_para_dono: "Explicação para o dono.",
      ativo: true,
      versao: 1,
      atualizado_em: null,
    })),
    respostas: SEMENTES_DO_QUADRO.map((r) => ({ passo: r.passo, intencao: r.intencao, frase: r.frase, casamento: r.casamento, ativo: true })),
    horarios: (HORARIO_SEMENTE.semana ?? []).map((h) => ({ dia_semana: h.diaSemana, abre: h.abre, fecha: h.fecha, ativo: h.ativo })),
    feriados: [{ data: "2026-12-25", nome: "Natal", fechado: true, abre: null, fecha: null }],
    contagens: { triagensEm7Dias: 3, porStatus: { concluida: 2, ensaio: 1 }, errosEm24h: 0, textosBarradosEm24h: 0 },
    ...p,
  };
}

function html(el: ReturnType<typeof createElement>): string {
  const qc = new QueryClient();
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el));
}
const nada = () => {};

describe("o painel de ligar", () => {
  it("desligada: mostra o degrau, o botão de subir para ensaio e o Desligar tudo desabilitado", () => {
    const h = html(createElement(PainelDeLiga, { painel: painel(), aoMudar: nada }));
    expect(h).toContain("Agora: Desligada");
    expect(h).toContain("Subir para ensaio");
    expect(h).toContain("Desligar tudo");
    expect(h).toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Desligar tudo/s);
    expect(h).toContain("Ainda não foi ligada.");
  });

  it("ensaio sem número de teste: o botão de subir fica desabilitado e a tela diz por quê", () => {
    const h = html(createElement(PainelDeLiga, { painel: painel({ estado: "ensaio" }), aoMudar: nada }));
    expect(h).toContain("Subir para teste");
    expect(h).toContain("Cadastre pelo menos um número de teste");
    expect(h).toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Subir para teste/s);
  });

  it("teste com número: o botão de subir fica habilitado e há degrau de descida", () => {
    const h = html(createElement(PainelDeLiga, { painel: painel({ estado: "teste", numeros_teste: ["96991112233"], percentual: 10 }), aoMudar: nada }));
    expect(h).toContain("96 99111-2233");
    expect(h).toContain("Subir para parcial");
    expect(h).toContain("Descer para ensaio");
    expect(h).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Subir para parcial/s);
    expect(h).toContain("O robô está respondendo de verdade neste degrau");
  });

  it("quem não pode ligar: todos os controles de ligar ficam desabilitados, mas o Desligar tudo vale", () => {
    const h = html(createElement(PainelDeLiga, { painel: painel({ estado: "parcial", numeros_teste: ["96991112233"], percentual: 10 }, { podeLigar: false }), aoMudar: nada }));
    expect(h).toContain("Só quem tem a permissão de gerenciar o WhatsApp");
    expect(h).not.toContain("whatsapp.manage");
    expect(h).toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Subir para ligada/s);
    expect(h).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Desligar tudo/s);
  });

  it("desligada pelo freio: diz o motivo", () => {
    const h = html(createElement(PainelDeLiga, { painel: painel({ desligada_por: "freio_falhas_de_envio" }), aoMudar: nada }));
    expect(h).toContain("Desligou sozinha: houve falhas seguidas no envio.");
  });
});

describe("as demais partes da tela", () => {
  it("textos: um editor por etapa, nos dois ramos, com a versão", () => {
    const h = html(createElement(TextosDasEtapas, { painel: painel(), aoMudar: nada }));
    expect(h).toContain("Para o cliente final");
    expect(h).toContain("Para quem quer ser parceiro");
    expect(h).toContain("Pedir o nome e o sobrenome");
    expect(h).toContain("Versão 1");
  });

  it("quadro: campo de teste, formulário e um grupo por intenção", () => {
    const h = html(createElement(QuadroDeRespostas, { painel: painel(), aoMudar: nada }));
    expect(h).toContain("Teste uma frase");
    expect(h).toContain("Juntar uma frase");
    expect(h).toContain("Quer falar com a equipe");
    expect(h).not.toContain("Não entendi</span>");
  });

  it("quadro sem permissão de editar: não mostra o formulário", () => {
    const h = html(createElement(QuadroDeRespostas, { painel: painel({}, { podeEditar: false }), aoMudar: nada }));
    expect(h).not.toContain("Juntar uma frase");
    expect(h).toContain("exige a permissão de gerenciar as configurações");
    expect(h).not.toContain("configuracoes.manage");
  });

  it("horários: sete dias e o feriado em dia/mês/ano", () => {
    const h = html(createElement(HorariosEFeriados, { painel: painel(), aoMudar: nada }));
    for (const d of ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]) expect(h).toContain(d);
    expect(h).toContain("25/12/2026");
    expect(h).toContain("Natal");
  });

  it("simulador: deixa claro que não envia nada e começa vazio", () => {
    const h = html(createElement(Simulador, { painel: painel() }));
    expect(h).toContain("Nada é enviado a ninguém");
    expect(h).toContain("Nenhuma mensagem ainda");
    expect(h).toContain("Mandar um áudio");
  });
});
