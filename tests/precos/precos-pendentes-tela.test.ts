import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/** A tela de preços pendentes renderiza no servidor, com dados de verdade, sem navegador e sem banco. */

vi.mock("@tanstack/react-start", async (original) => {
  const real = await original<typeof import("@tanstack/react-start")>();
  return { ...real, useServerFn: (f: unknown) => f };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { TooltipProvider } from "../../src/components/ui/tooltip";
import { PropostaDePrecoCartao } from "../../src/components/precos/proposta-de-preco";
import { Route } from "../../src/routes/_authenticated/precos-pendentes";
import type { PropostaDePreco } from "../../src/domain/precos/propostas";
import type { PainelDePrecos } from "../../src/lib/api/precos-pendentes.functions";

const proposta: PropostaDePreco = {
  id: "00000000-0000-4000-8000-000000000001",
  produto_id: "00000000-0000-4000-8000-000000000002",
  produto_nome: "Necessaire",
  unidade: "un",
  preco_atual: 40,
  preco_proposto: 49.9,
  custo: 30,
  piso: 42.86,
  margem_minima: 30,
  margem_atual: 25,
  margem_proposta: 39.88,
  motivo: "Preço abaixo do piso de 42,86.",
  origem: "abaixo_do_piso",
  created_at: "2026-11-15T12:00:00Z",
};

const qc = (painel?: PainelDePrecos) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (painel) c.setQueryData(["precos-pendentes"], painel);
  return c;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Pagina = (Route as any).options.component as () => ReturnType<typeof createElement>;
const paginaCom = (painel: PainelDePrecos) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc(painel) }, createElement(TooltipProvider, null, createElement(Pagina))));

describe("o cartão da proposta", () => {
  const html = (podeDecidir: boolean) =>
    renderToStaticMarkup(
      createElement(PropostaDePrecoCartao, { proposta, podeDecidir, ocupado: false, aoAprovar: () => {}, aoRecusar: () => {} }),
    );

  it("mostra produto, preços, piso em reais e as três barras com a margem em percentual", () => {
    const h = html(true);
    expect(h).toContain("Necessaire");
    expect(h).toContain("R$");
    expect(h).toContain("49,90");
    expect(h).toContain("42,86");
    expect(h).toContain("Piso da margem");
    expect(h).toContain("Margem de hoje");
    expect(h).toContain("Margem se aprovar");
    expect(h).toContain("25 por cento, abaixo do piso");
    expect(h).toContain("39,9 por cento, acima do piso");
    expect((h.match(/role="img"/g) ?? []).length).toBe(3);
  });

  it("cada barra tem um botão de explicação que o teclado e o toque alcançam, de 44 px", () => {
    const h = html(true);
    expect((h.match(/aria-label="Explicar: /g) ?? []).length).toBe(3);
    expect(h).toContain("h-11 w-11");
  });

  it("Aprovar e Recusar têm 44 px, e Recusar começa desligado sem motivo", () => {
    const h = html(true);
    expect(h).toContain(">Aprovar<");
    expect(h).toContain(">Recusar<");
    expect(h.match(/h-11 min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Recusar<\/button>/);
    expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*>Aprovar<\/button>/);
    expect(h).toContain("Motivo para recusar, obrigatório, com pelo menos 3 letras");
  });

  it("quem não decide não vê os botões", () => {
    const h = html(false);
    expect(h).not.toContain(">Aprovar<");
    expect(h).toContain("Só administrador ou gerente");
  });

  it("não deixa a cor sozinha: o texto da faixa está escrito", () => {
    expect(html(true)).toMatch(/abaixo do piso/);
  });
});

describe("a página", () => {
  const painel = (p: Partial<PainelDePrecos> = {}): PainelDePrecos => ({
    propostas: [proposta],
    podeDecidir: true,
    referencia: 70,
    mediaM2: { media: 57.5, quantidade: 2 },
    ...p,
  });

  it("explica em duas frases, mostra a média atual, a referência de 70 e a legenda escrita", () => {
    const h = paginaCom(painel());
    expect(h).toContain("Preços pendentes de aprovação");
    expect(h).toContain("57,50");
    expect(h).toContain("70,00 por metro quadrado");
    expect(h).toContain("Vermelho: margem abaixo do mínimo do produto");
    expect(h).toContain("Amarelo: margem menos de cinco pontos acima do mínimo");
    expect(h).toContain("Verde: margem cinco pontos ou mais acima do mínimo");
    expect(h).toContain("nunca é consertado baixando a margem mínima");
  });

  it("estado vazio claro", () => {
    const h = paginaCom(painel({ propostas: [] }));
    expect(h).toContain("Nenhum preço esperando aprovação.");
    expect(h).not.toContain("Necessaire");
  });

  it("sem média, escreve Sem dado em vez de zero", () => {
    expect(paginaCom(painel({ mediaM2: null }))).toContain("Sem dado");
  });
});
