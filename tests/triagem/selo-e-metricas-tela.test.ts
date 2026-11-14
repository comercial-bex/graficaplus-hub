import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * O selo da triagem (B9) e o painel de métricas (B10) renderizados com dados de verdade, no padrão de
 * tela-renderiza.test.ts: renderToStaticMarkup com QueryClientProvider e o cache preenchido por setQueryData. Sem
 * navegador e sem banco. Cobre os três estados do painel (carregando, erro, zerado) e o painel com dados.
 */

vi.mock("@tanstack/react-start", async (original) => {
  const real = await original<typeof import("@tanstack/react-start")>();
  return { ...real, useServerFn: (f: unknown) => f };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { TooltipProvider } from "../../src/components/ui/tooltip";
import { MetricasDaTriagem } from "../../src/components/triagem/metricas-da-triagem";
import {
  SeloDaTriagem,
  SeloDaTriagemNaLista,
} from "../../src/components/whatsapp/selo-da-triagem";
import {
  CHAVE_METRICAS_DA_TRIAGEM,
  chaveDasTriagens,
} from "../../src/components/whatsapp/usar-triagens-da-caixa";
import type { MetricasDaTriagem } from "../../src/lib/api/whatsapp-triagem.functions";
import type { LinhaDa30Dias, LinhaDoDia } from "../../src/domain/whatsapp/triagem/metricas";

function html(el: ReturnType<typeof createElement>, preparar?: (qc: QueryClient) => void): string {
  const qc = new QueryClient({ defaultOptions: { queries: { refetchOnMount: false, retryOnMount: false, retry: false } } });
  preparar?.(qc);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(TooltipProvider, null, el)),
  );
}

/** Texto que a pessoa lê: sem as marcas e com os espaços juntados. */
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ,/g, ",");

const janela = (o: Partial<LinhaDa30Dias> = {}): LinhaDa30Dias => ({
  ramo: "cliente",
  triadas: 0,
  puladas: 0,
  concluidas: 0,
  entregues_equipe: 0,
  abandonadas: 0,
  pausadas_humano: 0,
  triagens_com_pausa_humano: 0,
  enviou_boas_vindas: 0,
  respondeu_nome: 0,
  pediu_preco: 0,
  concluidas_com_tempo: 0,
  mediana_segundos_ate_concluir: null,
  ...o,
});

const dia = (o: Partial<LinhaDoDia> = {}): LinhaDoDia => ({
  dia: "2026-11-13",
  ramo: "cliente",
  triadas: 1,
  puladas: 0,
  em_andamento: 0,
  concluidas: 0,
  entregues_equipe: 0,
  abandonadas: 0,
  pausadas_humano: 0,
  pausadas_desligada: 0,
  paradas_pelo_contato: 0,
  enviou_boas_vindas: 0,
  respondeu_nome: 0,
  pediu_preco: 0,
  concluidas_com_tempo: 0,
  soma_segundos_ate_concluir: 0,
  ...o,
});

function painel(dados: MetricasDaTriagem) {
  return html(createElement(MetricasDaTriagem), (qc) => qc.setQueryData(CHAVE_METRICAS_DA_TRIAGEM, dados));
}

describe("selo da triagem na tela (B9)", () => {
  it("lista: estado curto à vista, frase e explicação em texto para leitor de tela, sem truncar", () => {
    const h = html(createElement(SeloDaTriagemNaLista, { status: "entregue_equipe" }));
    expect(h).toContain("entregue à equipe");
    expect(h).toMatch(/sr-only[^>]*>Triagem automática: entregue à equipe\./);
    expect(h).toContain("O robô parou e passou a conversa para a equipe, que precisa responder.");
    expect(h).not.toContain("truncate");
    expect(h).toContain("text-sm");
    expect(h).not.toContain("text-xs");
  });

  it("lista: sem triagem, simulação e conversa pulada não renderizam nada", () => {
    expect(html(createElement(SeloDaTriagemNaLista, { status: undefined }))).toBe("");
    expect(html(createElement(SeloDaTriagemNaLista, { status: "pulada" }))).toBe("");
    expect(html(createElement(SeloDaTriagemNaLista, { status: "ensaio" }))).toBe("");
  });

  it("cabeçalho: a frase completa e a explicação ficam escritas e visíveis, sem corte de largura", () => {
    const h = html(createElement(SeloDaTriagem, { conversaId: "c1" }), (qc) =>
      qc.setQueryData(chaveDasTriagens(["c1"]), {
        porConversa: new Map([["c1", { status: "pausada_humano" }]]),
        truncado: false,
      }),
    );
    expect(h).toContain("Triagem automática: pausada pela equipe");
    expect(h).toContain("Alguém da equipe respondeu ou assumiu a conversa, então o robô parou.");
    expect(h).not.toContain("sr-only");
    expect(h).not.toContain("max-w-[60%]");
    expect(h).not.toContain("truncate");
    expect(h).not.toContain("text-xs");
  });

  it("cabeçalho: conversa sem registro não renderiza nada", () => {
    const h = html(createElement(SeloDaTriagem, { conversaId: "c2" }), (qc) =>
      qc.setQueryData(chaveDasTriagens(["c2"]), { porConversa: new Map(), truncado: false }),
    );
    expect(h).toBe("");
  });
});

describe("painel de métricas (B10): três estados e dados", () => {
  it("carregando: mostra que está carregando, nem erro nem 'sem dados'", () => {
    const h = html(createElement(MetricasDaTriagem));
    expect(texto(h)).toContain("Carregando as métricas");
    expect(h).not.toContain("Sem dados ainda");
    expect(h).not.toContain("Não consegui carregar");
  });

  it("erro: diz que não conseguiu carregar, com o motivo e o botão, e não diz 'sem dados'", () => {
    const h = html(createElement(MetricasDaTriagem), (qc) => {
      qc.getQueryCache()
        .build(qc, { queryKey: CHAVE_METRICAS_DA_TRIAGEM })
        .setState({
          status: "error",
          error: new Error("As métricas da triagem ainda não foram instaladas no banco. Avise quem cuida do sistema."),
          fetchStatus: "idle",
          data: undefined,
        });
    });
    expect(h).toContain('role="alert"');
    expect(texto(h)).toContain("Não consegui carregar as métricas");
    expect(texto(h)).toContain("ainda não foram instaladas no banco");
    expect(texto(h)).toContain("Tentar de novo");
    expect(h).not.toContain("Sem dados ainda");
  });

  it("zerado: resposta honesta 'sem dados ainda', com as puladas à parte e concordando com o número", () => {
    const um = texto(painel({ dias: [], janela: [janela({ puladas: 1 })] }));
    expect(um).toContain("Sem dados ainda.");
    expect(um).toContain("1 conversa foi deixada de fora pelo robô no período, e por isso não conta.");
    const tres = texto(painel({ dias: [], janela: [janela({ puladas: 3 })] }));
    expect(tres).toContain("3 conversas foram deixadas de fora pelo robô no período, e por isso não contam.");
    const nenhuma = texto(painel({ dias: [], janela: [] }));
    expect(nenhuma).toContain("Sem dados ainda.");
    expect(nenhuma).not.toContain("deixada");
    expect(nenhuma).not.toContain("Não consegui carregar");
  });

  const comDados = (): MetricasDaTriagem => ({
    janela: [
      janela({
        triadas: 20,
        concluidas: 8,
        entregues_equipe: 3,
        abandonadas: 4,
        pausadas_humano: 1,
        triagens_com_pausa_humano: 5,
        enviou_boas_vindas: 16,
        respondeu_nome: 8,
        pediu_preco: 2,
        concluidas_com_tempo: 1,
        mediana_segundos_ate_concluir: 200,
      }),
      janela({ ramo: "parceiro", triadas: 5, concluidas: 1, concluidas_com_tempo: 3, mediana_segundos_ate_concluir: 45 }),
    ],
    dias: [
      dia({ dia: "2026-11-14", triadas: 0, puladas: 7 }),
      dia({ dia: "2026-11-13", triadas: 4, concluidas: 2, pausadas_humano: 1, soma_segundos_ate_concluir: 400, concluidas_com_tempo: 2 }),
    ],
  });

  it("com dados: números com denominador, singular e plural certos, sem parênteses", () => {
    const h = painel(comDados());
    const t = texto(h);
    expect(t).toContain("25 conversas triadas nos últimos 30 dias");
    expect(t).toContain("Concluídas 36% 9 de 25, das triadas.");
    expect(t).toContain("50% 8 de 16, de quem recebeu a primeira mensagem do robô.");
    expect(t).toContain("Em 5 conversas triadas nos últimos 30 dias a equipe assumiu e o robô parou");
    expect(t).toContain("Agora, 1 conversa segue pausada pela equipe");
    expect(t).toContain("Cliente final: 3 min 20 s, de 1 conversa concluída");
    expect(t).toContain("Parceiro: 45 s, de 3 conversas concluídas");
    expect(t).toContain("Outros 8");
    expect(t).toContain("O robô nunca responde valor. Equipe");
    expect(t).toContain("em andamento, robô desligado ou contato pediu para parar");
    // nenhum texto de tela com parênteses
    expect(t).not.toMatch(/[()]/);
    expect(t).not.toMatch(/\bconversa\(s\)|pausa\(s\)|concluída\(s\)/);
  });

  it("com dados: 'Por dia' tem cartões empilhados abaixo de md e tabela de md para cima, sem largura mínima", () => {
    const h = painel(comDados());
    expect(h).toMatch(/<ul[^>]*md:hidden/);
    expect(h).toMatch(/<div[^>]*hidden[^>]*md:block/);
    expect(h).not.toMatch(/min-w-\[/);
    expect(h).not.toContain("overflow-x-auto");
    // o dia só com puladas não aparece, em nenhuma das duas formas
    expect(h).not.toContain("14/11");
    expect(h).toContain("13/11");
    // o mesmo campo "Outros" por dia, e tempo médio de 200 s
    expect(texto(h)).toContain("3 min 20 s");
  });

  it("com dados: nenhum texto abaixo de 16 px no painel", () => {
    const h = painel(comDados());
    expect(h).not.toMatch(/text-(xs|sm)\b/);
  });
});
