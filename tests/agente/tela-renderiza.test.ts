import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SEMENTES_DO_QUADRO } from "../../src/domain/whatsapp/triagem";
import { basePadrao, resposta } from "./montar";

/**
 * A tela do agente (C4) renderizada com dados de verdade, no padrão de tests/triagem/tela-renderiza.test.ts: renderToStaticMarkup
 * com QueryClientProvider e o cache preenchido por setQueryData. Sem navegador e sem banco. Cobre a escada em cada degrau, o
 * aviso das respostas aprovadas, o simulador, os três estados das métricas (carregando, erro, zerado) com e sem dados, o selo
 * da conversa e as regras de leitura do dono: letra de 16 px, alvo de 44 px, sem travessão, seta nem parênteses.
 */

vi.mock("@tanstack/react-start", async (original) => {
  const real = await original<typeof import("@tanstack/react-start")>();
  return { ...real, useServerFn: (f: unknown) => f };
});
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) =>
    createElement("a", { href: to, className }, children),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { BaseAprovada } from "../../src/components/agente/base-aprovada";
import {
  MetricasDoAgente,
  CHAVE_METRICAS_DO_AGENTE,
} from "../../src/components/agente/metricas-do-agente";
import { PainelDeLigaDoAgente } from "../../src/components/agente/painel-de-liga";
import { SimuladorDoAgente } from "../../src/components/agente/simulador-do-agente";
import {
  CHAVE_AGENTE_DA_CONVERSA,
  SeloDoAgente,
} from "../../src/components/whatsapp/selo-do-agente";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { coberturaDaBase } from "../../src/domain/agente/painel";
import { diaAntes } from "../../src/domain/agente/metricas";
import { diaCurto } from "../../src/domain/whatsapp/triagem/metricas";
import { hojeBr } from "../../src/lib/hoje-br";
import type {
  MetricasDoAgenteDaTela,
  PainelDoAgente,
} from "../../src/lib/api/agente-escolhe.functions";

function html(el: ReturnType<typeof createElement>, preparar?: (qc: QueryClient) => void): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { refetchOnMount: false, retryOnMount: false, retry: false } },
  });
  preparar?.(qc);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(TooltipProvider, null, el)),
  );
}
/** Texto que a pessoa lê: sem as marcas e com os espaços juntados. */
const texto = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ,/g, ",")
    .replace(/ \./g, ".");

type Instalado = PainelDoAgente & { config: NonNullable<PainelDoAgente["config"]> };

function painel(o: Partial<Instalado["config"]> = {}, p: Partial<PainelDoAgente> = {}): Instalado {
  return {
    instalada: true,
    podeLigar: true,
    chaveAntigaLigada: false,
    config: {
      estado: "desligada",
      percentual: 0,
      numeros_teste: [],
      vale_a_partir_de: null,
      max_mensagens: 3,
      max_por_hora: 20,
      max_por_dia: 100,
      avisar_grupo: true,
      desligada_por: null,
      desligada_em: null,
      atualizado_em: null,
      ...o,
    },
    base: basePadrao(),
    quadro: SEMENTES_DO_QUADRO.map((r, i) => ({
      id: i,
      passo: r.passo,
      intencao: r.intencao,
      frase: r.frase,
      casamento: r.casamento,
    })),
    termos: [],
    errosEm24h: 0,
    ...p,
  };
}
const nada = () => {};
const botaoDe = (h: string, rotulo: string) => {
  const m = [...h.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map((x) => x[0])
    .find((b) => texto(b).includes(rotulo));
  return m ?? null;
};
const desabilitado = (b: string | null) =>
  b ? /\sdisabled(=|\s|>)/.test(b.split(">")[0] + ">") : null;

const quinze = (ramo: "cliente" | "parceiro") =>
  Array.from({ length: 15 }, (_, i) =>
    resposta({
      id: `${ramo}${i}`,
      ramos: [ramo],
      tema: `t_${ramo}_${i}`,
      frases_gatilho: [`f ${ramo} ${i}`],
    }),
  );

describe("o painel de ligar, degrau por degrau", () => {
  it("desligada: mostra o degrau, o botão grande de subir para ensaio e o Desligar tudo apagado", () => {
    const h = html(createElement(PainelDeLigaDoAgente, { painel: painel(), aoMudar: nada }));
    const t = texto(h);
    expect(t).toContain("Agora: Desligada");
    expect(t).toContain("Subir para ensaio");
    expect(desabilitado(botaoDe(h, "Subir para ensaio"))).toBe(false);
    expect(desabilitado(botaoDe(h, "Desligar tudo"))).toBe(true);
    expect(t).toContain("Ainda não foi ligado.");
    expect(h).toContain('aria-label="Os cinco degraus"');
    for (const d of ["Desligada", "Ensaio", "Teste", "Parcial", "Ligada"]) expect(t).toContain(d);
  });

  it("em cada degrau, o botão de subir fala do próximo e o Desligar tudo acende", () => {
    const esperado: Record<string, string> = {
      ensaio: "Subir para teste",
      teste: "Subir para parcial",
      parcial: "Subir para ligada",
      ligada: "Já está no último degrau",
    };
    for (const [estado, rotulo] of Object.entries(esperado)) {
      const h = html(
        createElement(PainelDeLigaDoAgente, {
          painel: painel({
            estado: estado as never,
            percentual: 10,
            numeros_teste: ["5596991112233"],
          }),
          aoMudar: nada,
        }),
      );
      expect(texto(h), estado).toContain(rotulo);
      expect(texto(h), estado).toContain(`Agora: ${estado[0].toUpperCase()}${estado.slice(1)}`);
      expect(desabilitado(botaoDe(h, "Desligar tudo")), estado).toBe(false);
    }
  });

  it("ZERO aprovadas: não deixa subir para teste, diz por quê e mostra o aviso à vista", () => {
    const h = html(
      createElement(PainelDeLigaDoAgente, {
        painel: painel({ estado: "ensaio", numeros_teste: ["5596991112233"] }, { base: [] }),
        aoMudar: nada,
      }),
    );
    const t = texto(h);
    expect(desabilitado(botaoDe(h, "Subir para teste"))).toBe(true);
    expect(t).toContain("Nenhuma resposta está aprovada. Aprove ao menos uma");
    expect(t).toContain("Cliente final: 0 de 15 aprovadas");
    expect(t).toContain("Parceiro: 0 de 15 aprovadas");
    expect(h).toContain('role="alert"');
    expect(t).toContain("Faltam respostas aprovadas.");
  });

  it("com algumas aprovadas, sobe, mas o aviso continua à vista, com N de 15", () => {
    const h = html(
      createElement(PainelDeLigaDoAgente, {
        painel: painel({ estado: "ensaio", numeros_teste: ["5596991112233"] }),
        aoMudar: nada,
      }),
    );
    const t = texto(h);
    expect(desabilitado(botaoDe(h, "Subir para teste"))).toBe(false);
    expect(t).toContain("Cliente final: 4 de 15 aprovadas");
    expect(t).toContain("Cliente final tem só 4 de 15 respostas aprovadas. Faltam 11.");
    expect(t).toContain("Faltam respostas aprovadas.");
  });

  it("chave antiga de texto livre ligada: o botão de subir fica apagado e a tela diz por quê, em palavras", () => {
    for (const estado of ["desligada", "ensaio", "teste"] as const) {
      const h = html(
        createElement(PainelDeLigaDoAgente, {
          painel: painel(
            { estado, percentual: 10, numeros_teste: ["5596991112233"] },
            { chaveAntigaLigada: true },
          ),
          aoMudar: nada,
        }),
      );
      const t = texto(h);
      expect(t, estado).toContain("A chave antiga de texto livre depois da triagem está ligada");
      expect(t, estado).toContain("Desligue essa chave antes de subir o agente.");
      expect(desabilitado(botaoDe(h, "Subir para")), estado).toBe(true);
    }
    // descer e Desligar tudo continuam à mão
    const h = html(
      createElement(PainelDeLigaDoAgente, {
        painel: painel(
          { estado: "teste", numeros_teste: ["5596991112233"] },
          { chaveAntigaLigada: true },
        ),
        aoMudar: nada,
      }),
    );
    expect(desabilitado(botaoDe(h, "Desligar tudo"))).toBe(false);
    expect(desabilitado(botaoDe(h, "Descer para ensaio"))).toBe(false);
  });

  it("em parcial a porcentagem salva acima de 50 aparece como inválida, com a frase que manda subir para ligada", () => {
    const h = html(
      createElement(PainelDeLigaDoAgente, {
        painel: painel({ estado: "parcial", percentual: 80, numeros_teste: ["5596991112233"] }),
        aoMudar: nada,
      }),
    );
    expect(texto(h)).toContain(
      "Escreva um número de 0 a 50. Para todos os contatos, suba para ligada.",
    );
    expect(desabilitado(botaoDe(h, "Salvar porcentagem"))).toBe(true);
  });

  it("15 aprovadas em cada ramo: o aviso some e diz que está completo", () => {
    const base = [
      ...quinze("cliente"),
      ...quinze("parceiro"),
      ...basePadrao()
        .filter((r) => r.tema === "valor_do_produto")
        .map((r) => ({ ...r, ramos: ["cliente", "parceiro"] as ("cliente" | "parceiro")[] })),
    ];
    const h = html(
      createElement(PainelDeLigaDoAgente, { painel: painel({}, { base }), aoMudar: nada }),
    );
    const t = texto(h);
    expect(t).not.toContain("Faltam respostas aprovadas.");
    expect(t).toContain("Todos os ramos têm o mínimo de respostas aprovadas.");
    expect(t).toContain("Cliente final: 16 de 15 aprovadas");
  });

  it("rascunhos aparecem como o que esperam, e há um botão para ir aprovar", () => {
    const base = [
      ...basePadrao(),
      resposta({
        id: "r",
        status: "rascunho",
        frases_gatilho: ["x"],
        texto_aprovado: undefined,
        resposta: "Rascunho.",
      }),
    ];
    const h = html(
      createElement(PainelDeLigaDoAgente, { painel: painel({}, { base }), aoMudar: nada }),
    );
    expect(texto(h)).toContain("1 rascunho espera a sua aprovação.");
    expect(h).toContain('href="/configuracoes-agente-base"');
    expect(texto(h)).toContain("Aprovar respostas");
  });

  it("quem não tem whatsapp.manage vê o botão apagado e a explicação", () => {
    const h = html(
      createElement(PainelDeLigaDoAgente, {
        painel: painel({}, { podeLigar: false }),
        aoMudar: nada,
      }),
    );
    expect(desabilitado(botaoDe(h, "Subir para ensaio"))).toBe(true);
    expect(texto(h)).toContain(
      "Só quem tem a permissão de gerenciar o WhatsApp liga, sobe e desce o agente.",
    );
    expect(texto(h)).toContain("apertar Desligar tudo");
  });

  it("desligado por um freio: diz o motivo; parcial mostra a porcentagem; degrau que fala de verdade avisa", () => {
    const freio = texto(
      html(
        createElement(PainelDeLigaDoAgente, {
          painel: painel({ desligada_por: "freio_falhas_de_envio" }),
          aoMudar: nada,
        }),
      ),
    );
    expect(freio).toContain("Desligou sozinho: houve falhas seguidas no envio.");
    const parcial = texto(
      html(
        createElement(PainelDeLigaDoAgente, {
          painel: painel({ estado: "parcial", percentual: 25 }),
          aoMudar: nada,
        }),
      ),
    );
    expect(parcial).toContain("25 de cada 100 contatos");
    expect(parcial).toContain("O agente está respondendo de verdade neste degrau.");
    const ensaio = texto(
      html(
        createElement(PainelDeLigaDoAgente, {
          painel: painel({ estado: "ensaio" }),
          aoMudar: nada,
        }),
      ),
    );
    expect(ensaio).not.toContain("O agente está respondendo de verdade neste degrau.");
  });

  it("mostra o teto, o freio e os erros de 24 horas, sem texto de mensagem nenhum", () => {
    const t = texto(
      html(
        createElement(PainelDeLigaDoAgente, {
          painel: painel({}, { errosEm24h: 3 }),
          aoMudar: nada,
        }),
      ),
    );
    expect(t).toContain("Erros nas últimas 24 horas: 3.");
    expect(t).toContain("Até 3 respostas por conversa, no máximo 20 por hora e 100 por dia.");
  });

  it("o contador sozinho: BaseAprovada diz de quantas, por ramo", () => {
    const t = texto(
      html(createElement(BaseAprovada, { cobertura: coberturaDaBase(basePadrao()) })),
    );
    expect(t).toContain("Cliente final: 4 de 15 aprovadas");
    expect(t).toContain("Parceiro: 0 de 15 aprovadas");
  });
});

describe("o simulador", () => {
  it("renderiza com o campo, o ramo e o botão, e diz que não envia nada", () => {
    const h = html(createElement(SimuladorDoAgente, { painel: painel() }));
    const t = texto(h);
    expect(t).toContain("Nada é enviado a ninguém e nada é gravado");
    expect(t).toContain("Ver o que o agente faria");
    expect(t).toContain("Nenhuma pergunta simulada ainda.");
    expect(h).toContain('id="sim-agente-texto"');
    expect(t).toContain("Cliente final");
    expect(t).toContain("Parceiro");
  });

  it("sem resposta aprovada, avisa antes de o dono perguntar", () => {
    const t = texto(html(createElement(SimuladorDoAgente, { painel: painel({}, { base: [] }) })));
    expect(t).toContain(
      "Nenhuma resposta está aprovada. O simulador vai mostrar que o agente entrega toda pergunta à equipe.",
    );
  });

  it("não há caminho daqui até o servidor ou o WhatsApp", () => {
    const src = readFileSync("src/components/agente/simulador-do-agente.tsx", "utf8");
    expect(src).not.toMatch(
      /useServerFn|useMutation|useQuery|fetch\(|supabase|rodadaDoServidor|enviar/,
    );
    expect(src).toMatch(/simularAgente\(/);
  });
});

describe("métricas: três estados e dados", () => {
  const HOJE = hojeBr();
  const dados = (o: Partial<MetricasDoAgenteDaTela> = {}): MetricasDoAgenteDaTela => ({
    hoje: HOJE,
    dias: [],
    motivos: [],
    respostas: [],
    semResposta: [],
    base: [],
    ...o,
  });
  const metricas = (d: MetricasDoAgenteDaTela) =>
    html(createElement(MetricasDoAgente), (qc) => qc.setQueryData(CHAVE_METRICAS_DO_AGENTE, d));

  it("carregando: diz que está carregando, nem erro nem 'sem dados'", () => {
    const h = html(createElement(MetricasDoAgente));
    expect(texto(h)).toContain("Carregando as métricas");
    expect(h).not.toContain("Sem dados ainda");
    expect(h).not.toContain("Não consegui carregar");
  });

  it("erro: diz que não conseguiu, com o botão, e não diz 'sem dados'", () => {
    const h = html(createElement(MetricasDoAgente), (qc) => {
      qc.getQueryCache()
        .build(qc, { queryKey: CHAVE_METRICAS_DO_AGENTE })
        .setState({
          status: "error",
          error: new Error(
            "As métricas do agente ainda não foram instaladas no banco. Avise quem cuida do sistema.",
          ),
          fetchStatus: "idle",
          data: undefined,
        });
    });
    expect(h).toContain('role="alert"');
    expect(texto(h)).toContain("Não consegui carregar as métricas do agente");
    expect(texto(h)).toContain("ainda não foram instaladas no banco");
    expect(texto(h)).toContain("Tentar de novo");
    expect(h).not.toContain("Sem dados ainda");
  });

  it("zerado: resposta honesta 'sem dados ainda', que não é erro", () => {
    const t = texto(metricas(dados()));
    expect(t).toContain("Sem dados ainda.");
    expect(t).toContain("enquanto ele está desligado");
    expect(t).not.toContain("Não consegui carregar");
    expect(t).not.toContain("%");
  });

  it("decisão antiga demais (fora dos 30 dias) também é 'sem dados ainda'", () => {
    const t = texto(
      metricas(
        dados({
          dias: [
            {
              dia: diaAntes(HOJE, 45),
              modo: "real",
              ramo: "cliente",
              decisoes: 5,
              escolhidas: 5,
              entregues: 0,
              barradas: 0,
              sensiveis: 0,
            },
          ],
        }),
      ),
    );
    expect(t).toContain("Sem dados ainda.");
  });

  const comDados = (): MetricasDoAgenteDaTela =>
    dados({
      dias: [
        {
          dia: HOJE,
          modo: "real",
          ramo: "cliente",
          decisoes: 9,
          escolhidas: 3,
          entregues: 3,
          barradas: 3,
          sensiveis: 2,
        },
        {
          dia: HOJE,
          modo: "real",
          ramo: "parceiro",
          decisoes: 2,
          escolhidas: 1,
          entregues: 1,
          barradas: 0,
          sensiveis: 0,
        },
        {
          dia: HOJE,
          modo: "ensaio",
          ramo: "cliente",
          decisoes: 4,
          escolhidas: 2,
          entregues: 1,
          barradas: 1,
          sensiveis: 0,
        },
      ],
      motivos: [
        { modo: "real", ramo: "cliente", acao: "entregar", motivo: "sem_resposta", n: 3 },
        { modo: "real", ramo: "cliente", acao: "entregar", motivo: "preco_de_novo", n: 1 },
        { modo: "real", ramo: "cliente", acao: "entregar", motivo: "passou_com_a_resposta", n: 1 },
        { modo: "real", ramo: "cliente", acao: "barrar", motivo: "cortesia", n: 3 },
        { modo: "ensaio", ramo: "cliente", acao: "entregar", motivo: "sem_resposta", n: 1 },
      ],
      respostas: [
        {
          resposta_id: "horario",
          tema: "horario_de_atendimento",
          status: "aprovada",
          versao: 1,
          usos_real_30_dias: 4,
          usos_ensaio_30_dias: 2,
          usos_total: 6,
          ultimo_uso: null,
        },
        {
          resposta_id: "valor",
          tema: "valor_do_produto",
          status: "aprovada",
          versao: 1,
          usos_real_30_dias: 0,
          usos_ensaio_30_dias: 0,
          usos_total: 0,
          ultimo_uso: null,
        },
      ],
      semResposta: [
        { dia: HOJE, modo: "real", ramo: "cliente", perguntas_sem_resposta: 3 },
        { dia: HOJE, modo: "ensaio", ramo: "cliente", perguntas_sem_resposta: 1 },
      ],
      base: [
        {
          id: "horario",
          pergunta: "Qual o horário de atendimento?",
          tema: "horario_de_atendimento",
        },
        { id: "valor", pergunta: "Quanto custa?", tema: "valor_do_produto" },
      ],
    });

  it("com dados: cada número com o denominador, real e ensaio em blocos separados", () => {
    const t = texto(metricas(comDados()));
    expect(t).toContain("Respostas de verdade");
    expect(t).toContain("Ensaio: o que o agente faria");
    expect(t).toContain(
      "8 perguntas lidas e respondidas ou entregues, mais 3 mensagens em silêncio",
    );
    // real: 4 escolhidas de 8 perguntas, que são 3+1 escolhidas e 3+1 entregues
    expect(t).toContain("Cobertura 50% 4 de 8, das perguntas tiveram uma resposta aprovada.");
    expect(t).toContain(
      "Voltou para a equipe 50% 4 de 8, das perguntas foram passadas para a equipe.",
    );
    expect(t).toContain(
      "Perguntaram preço 25% 2 de 8, das perguntas. O agente nunca diz valor, só que a equipe confirma.",
    );
    // ensaio: 2 de 3
    expect(t).toContain(
      "Cobertura em ensaio 67% 2 de 3, das perguntas tiveram uma resposta aprovada.",
    );
  });

  it("com dados: a volta à equipe por motivo diz de quantas, com o texto em palavras, e a soma fecha", () => {
    const t = texto(metricas(comDados()));
    expect(t).toContain("Por que o agente passou a conversa para a equipe");
    expect(t).toContain("Total: 5. Cada linha diz quantas, das conversas passadas para a equipe.");
    expect(t).toContain("3 de 5, 60%: Nenhuma resposta aprovada serve para esta pergunta.");
    expect(t).toContain("1 de 5, 20%: É a segunda pergunta de preço desta conversa.");
    expect(t).toContain(
      "1 de 5, 20%: O agente escolheu a resposta aprovada de falar com a equipe, colocou na fila e passou a conversa para a equipe.",
    );
    expect(t).toContain("3 de 3, 100%: É um cumprimento ou um agradecimento");
    // o total da lista inclui a conversa respondida e depois passada, e a tela explica a diferença para o cartão
    expect(t).toContain(
      "O total inclui as conversas em que o agente respondeu antes de passar para a equipe.",
    );
    // nenhum código técnico solto
    expect(t).not.toMatch(/\b(sem_resposta|preco_de_novo|passou_com_a_resposta)\b/);
  });

  it("com dados: mais usadas com a pergunta do dono, nunca usadas com a taxa, sem resposta por dia só em contagem", () => {
    const t = texto(metricas(comDados()));
    expect(t).toContain("4 vezes: Qual o horário de atendimento?");
    expect(t).toContain("1 de 2, 50% das respostas aprovadas nunca foram usadas");
    expect(t).toContain("Quanto custa?");
    expect(t).toContain(`${diaCurto(HOJE)}: 3 de 8 perguntas`);
    expect(t).toContain("a frase do cliente não é guardada");
  });

  it("com dados só em ensaio: o bloco de verdade diz 'sem dados ainda' e o de ensaio mostra os números", () => {
    const d = dados({
      dias: [
        {
          dia: HOJE,
          modo: "ensaio",
          ramo: "cliente",
          decisoes: 3,
          escolhidas: 2,
          entregues: 1,
          barradas: 0,
          sensiveis: 0,
        },
      ],
    });
    const t = texto(metricas(d));
    expect(t).toContain(
      "O agente ainda não respondeu nem entregou nenhuma conversa de verdade nos últimos 30 dias.",
    );
    expect(t).toContain("Cobertura em ensaio 67% 2 de 3");
  });

  it("sem aprovada nenhuma, não inventa porcentagem das nunca usadas", () => {
    const t = texto(
      metricas(
        dados({
          dias: [
            {
              dia: HOJE,
              modo: "real",
              ramo: "cliente",
              decisoes: 1,
              escolhidas: 0,
              entregues: 1,
              barradas: 0,
              sensiveis: 0,
            },
          ],
        }),
      ),
    );
    expect(t).toContain("Nenhuma resposta está aprovada ainda.");
    expect(t).toContain("Cobertura 0% 0 de 1");
  });

  it("nenhum texto abaixo de 16 px e nenhuma classe de largura mínima que estoure no celular", () => {
    const h = metricas(comDados());
    expect(h).not.toMatch(/text-(xs|sm)\b/);
    expect(h).not.toMatch(/min-w-\[/);
  });
});

describe("o selo Agente na conversa", () => {
  const selo = (r: unknown) =>
    html(createElement(SeloDoAgente, { conversaId: "c1" }), (qc) => {
      if (r !== undefined) qc.setQueryData([...CHAVE_AGENTE_DA_CONVERSA, "c1"], r);
    });

  it("escolheu e colocou na fila: o evento enviado marca a fila, não a entrega, e o selo diz isso", () => {
    const h = selo({ instalado: true, respostas: 1, entregou: false });
    expect(h).toContain("Agente: escolheu uma resposta e colocou na fila");
    expect(h).toContain("O agente escolheu uma resposta aprovada");
    expect(h).toContain("Confira na conversa se ela chegou ao contato");
    // nunca afirma que respondeu ou enviou: só que escolheu e colocou na fila
    expect(h).not.toMatch(/Agente: respondeu/);
    expect(h).not.toContain("truncate");
    expect(h).not.toContain("text-xs");
  });

  it("escolheu e entregou, só entregou, e várias respostas", () => {
    expect(selo({ instalado: true, respostas: 1, entregou: true })).toContain(
      "Agente: escolheu uma resposta, colocou na fila e entregou à equipe",
    );
    const so = selo({ instalado: true, respostas: 0, entregou: true });
    expect(so).toContain("Agente: entregou à equipe");
    // o motivo não fica escondido numa tela que o selo não abre
    expect(so).not.toContain("O motivo está nas métricas do agente");
    expect(selo({ instalado: true, respostas: 3, entregou: false })).toContain(
      "Agente: escolheu 3 respostas e colocou na fila",
    );
  });

  it("sem registro, sem leitura ainda ou migração ausente: não renderiza nada", () => {
    expect(selo({ instalado: true, respostas: 0, entregou: false })).toBe("");
    expect(selo(undefined)).toBe("");
    expect(selo({ instalado: false, respostas: 4, entregou: true })).toBe("");
  });

  it("está no cabeçalho da conversa, ao lado do selo da triagem", () => {
    const src = readFileSync("src/components/whatsapp/cabecalho-da-conversa.tsx", "utf8");
    expect(src).toMatch(
      /<SeloDaTriagem conversaId=\{conversa\.id\} \/>\s*<SeloDoAgente conversaId=\{conversa\.id\} \/>/,
    );
  });
});

describe("a tela é legível: letra de 16 px, alvo de 44 px, sem símbolo proibido", () => {
  const arquivos = [
    ...readdirSync("src/components/agente").map((n) => join("src/components/agente", n)),
    "src/routes/_authenticated/configuracoes-agente.tsx",
  ];

  it("encontra os arquivos da tela", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(5);
  });

  it("nenhuma classe de letra menor que 16 px", () => {
    for (const a of arquivos) {
      expect(readFileSync(a, "utf8"), a).not.toMatch(
        /\btext-(xs|sm)\b|text-\[(1[0-5]|[0-9])px\]|text-\[0\.[0-9]+rem\]/,
      );
    }
  });

  it("todo botão da tela usa a altura de 44 px ou a constante que a tem", () => {
    for (const a of arquivos.filter((x) => x.endsWith(".tsx"))) {
      const botoes = [...readFileSync(a, "utf8").matchAll(/<Button\b[^>]*>/g)].map((m) => m[0]);
      for (const b of botoes) {
        expect(
          /className=\{?[^>]*(BOTAO|min-h-1[1-9]|min-h-14)/.test(b) ||
            /\bclassName=\{cn\([^)]*(BOTAO|min-h-14)/.test(b),
          `${a}: ${b}`,
        ).toBe(true);
      }
    }
  });

  it("nenhum travessão ou seta em texto de tela, nem a palavra do mercado que o dono não usa", () => {
    for (const a of arquivos) {
      const linhas = readFileSync(a, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && !/title:|<title>/.test(l));
      for (const l of linhas) {
        expect(l, `${a}: ${l}`).not.toMatch(/[—–―→←⇒]/);
        expect(l, `${a}: ${l}`).not.toMatch(/revend/i);
      }
    }
  });

  it("confirmações grandes: Subir, aumentar a porcentagem e Desligar tudo usam ConfirmarAcao com `grande`", () => {
    const src = readFileSync("src/components/agente/painel-de-liga.tsx", "utf8");
    const confirmacoes = [
      ...src.matchAll(/<ConfirmarAcao\b[\s\S]*?>\s*(?=\{botaoDeSubir\}|\{botaoSalvar\}|<Button)/g),
    ].map((m) => m[0]);
    // subir um degrau, aumentar a porcentagem em parcial e Desligar tudo
    expect(confirmacoes).toHaveLength(3);
    for (const c of confirmacoes) expect(c).toMatch(/\bgrande\b/);
    expect(src).toMatch(/destrutivo/);
  });

  it("o painel recarrega também quando a gravação ou a mudança de degrau FALHAM, e o campo da porcentagem acompanha o painel", () => {
    const src = readFileSync("src/components/agente/painel-de-liga.tsx", "utf8");
    // mudar o degrau, desligar e gravar a configuração: o onError de cada uma das três chama aoMudar()
    const mutacoes = src
      .split("useMutation({")
      .slice(1)
      .map((m) => m.slice(0, m.indexOf("\n  });")));
    expect(mutacoes).toHaveLength(3);
    for (const m of mutacoes) expect(m).toMatch(/onError:[\s\S]*aoMudar\(\)/);
    // o campo ressincroniza com o valor salvo quando o painel recarrega
    expect(src).toMatch(
      /useEffect\(\(\) => \{\s*setValor\(String\(painel\.config\.percentual\)\);\s*\}, \[painel\.config\.percentual\]\)/,
    );
  });

  it("o simulador não mostra o código do motivo e limpa o resultado quando a base recarrega", () => {
    const src = readFileSync("src/components/agente/simulador-do-agente.tsx", "utf8");
    expect(src).not.toMatch(/Código do motivo/);
    expect(src).toMatch(
      /useEffect\(\(\) => \{\s*setResultado\(null\);\s*setPerguntada\(null\);\s*\}, \[painel\.base, painel\.quadro, painel\.termos\]\)/,
    );
  });

  it("o cabeçalho da tela é legível e a rota usa a dica da central", () => {
    const rota = readFileSync("src/routes/_authenticated/configuracoes-agente.tsx", "utf8");
    expect(rota).toMatch(/<SectionHeader\s+legivel/);
    expect(rota).toMatch(/dicaTela\("\/configuracoes-agente"\)/);
  });

  it("nenhum texto renderizado das telas tem travessão, seta ou parênteses", () => {
    const hs = [
      html(
        createElement(PainelDeLigaDoAgente, {
          painel: painel({ estado: "ensaio", numeros_teste: ["5596991112233"] }),
          aoMudar: nada,
        }),
      ),
      html(
        createElement(PainelDeLigaDoAgente, { painel: painel({}, { base: [] }), aoMudar: nada }),
      ),
      html(createElement(SimuladorDoAgente, { painel: painel() })),
      html(createElement(MetricasDoAgente)),
    ];
    for (const h of hs) {
      const t = texto(h).replace(/Os cinco degraus/g, "");
      expect(t).not.toMatch(/[—–―→←⇒()]/);
    }
  });
});

describe("a tela está registrada como as outras de Configurações", () => {
  it("permissão, menu, dica, link em Dados da empresa e árvore de rotas", () => {
    expect(readFileSync("src/lib/permissions.ts", "utf8")).toMatch(
      /path: "\/configuracoes-agente", permissions: \["configuracoes\.manage", "whatsapp\.manage"\]/,
    );
    expect(readFileSync("src/lib/menu.ts", "utf8")).toMatch(
      /"\/configuracoes-agente": \{\s*titulo: "Agente de respostas"/,
    );
    expect(readFileSync("src/lib/dicas.ts", "utf8")).toMatch(
      /"\/configuracoes-agente": \{\s*menu:/,
    );
    expect(readFileSync("src/routes/_authenticated/configuracoes-empresa.tsx", "utf8")).toMatch(
      /<Link to="\/configuracoes-agente">/,
    );
    const arvore = readFileSync("src/routeTree.gen.ts", "utf8");
    expect(arvore).toMatch(/'\/_authenticated\/configuracoes-agente': \{/);
    expect(arvore).toMatch(
      /AuthenticatedConfiguracoesAgenteRoute: AuthenticatedConfiguracoesAgenteRoute,/,
    );
    expect(arvore).toMatch(
      /import \{ Route as AuthenticatedConfiguracoesAgenteRouteImport \} from '\.\/routes\/_authenticated\/configuracoes-agente'/,
    );
  });

  it("a permissão da rota vem antes de /configuracoes, que casa por prefixo, e não captura a tela da base", () => {
    const src = readFileSync("src/lib/permissions.ts", "utf8");
    expect(src.indexOf('"/configuracoes-agente"')).toBeGreaterThan(0);
    expect(src.indexOf('"/configuracoes-agente"')).toBeLessThan(
      src.indexOf('{ path: "/configuracoes", permissions: [] }'),
    );
  });

  it("a mesma regra de permissão vale para as duas telas do agente, e a barra do prefixo não mistura as duas", async () => {
    const { getRoutePermissions } = await import("../../src/lib/permissions");
    expect(getRoutePermissions("/configuracoes-agente")).toEqual([
      "configuracoes.manage",
      "whatsapp.manage",
    ]);
    expect(getRoutePermissions("/configuracoes-agente-base")).toEqual([
      "configuracoes.manage",
      "whatsapp.manage",
    ]);
    expect(getRoutePermissions("/configuracoes-agente/qualquer")).toEqual([
      "configuracoes.manage",
      "whatsapp.manage",
    ]);
  });
});
