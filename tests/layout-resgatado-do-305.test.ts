import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusChip } from "../src/components/bex/StatusChip";

/**
 * Correções de layout resgatadas do PR #305 (pele visual), 03/11/2026.
 *
 * A pele em si (papel, vidro, menu flutuante, acento ciano no escuro) NÃO entrou: contradiz o
 * que o dono decidiu depois (tema escuro Neon Cyber, barra escura da marca). Ficaram só os
 * defeitos medidos no #305 que existem na main: aviso de prazo cobrindo o número da OS no
 * cartão do quadro, nomes de etapa se encostando no celular e indicadores cortados.
 */
const ler = (p: string) => readFileSync(p, "utf8");

describe("cartão do quadro: número e aviso na mesma linha", () => {
  const CARTAO = ler("src/components/kanban/cartao-os.tsx");
  it("o número não é mais posicionado sozinho num canto, onde o aviso o cobria", () => {
    expect(CARTAO).not.toContain('className="absolute left-2 top-2');
    expect(CARTAO).not.toContain('className="absolute right-2 top-2');
    expect(CARTAO).toContain('className="absolute inset-x-2 top-2 flex flex-wrap items-start gap-1"');
    expect(CARTAO).toContain('className="shrink-0 rounded-md');
  });
  it("os avisos usam o selo compacto e a capa sem imagem tem altura mínima", () => {
    expect(CARTAO).toContain("<StatusChip compacto");
    expect(CARTAO).toContain('min-h-[104px]');
  });
});

describe("selo de status", () => {
  it("compacto tem menos altura e o rótulo encolhe com reticências em vez de cobrir o vizinho", () => {
    const normal = renderToStaticMarkup(createElement(StatusChip, { label: "Atrasada" }));
    const compacto = renderToStaticMarkup(createElement(StatusChip, { label: "Atrasada", compacto: true }));
    expect(normal).toContain("py-1.5");
    expect(compacto).toContain("py-0.5");
    expect(compacto).not.toContain("py-1.5");
    for (const html of [normal, compacto]) {
      expect(html).toContain("min-w-0");
      expect(html).toContain("max-w-full");
      expect(html).toContain('<span class="truncate">Atrasada</span>');
    }
  });
});

describe("etapas no celular", () => {
  it("a trilha da OS diz só a etapa atual abaixo dos pontos; os outros nomes ficam para o leitor de tela", () => {
    const TRILHA = ler("src/components/kanban/trilha-da-os.tsx");
    expect(TRILHA).toContain("max-md:sr-only");
    expect(TRILHA).toContain("md:hidden");
    expect(TRILHA).toContain("{atual + 1} de {ETAPAS_QUADRO.length} · {nomeAtual}");
  });
  it("o assistente em passos só mostra o nome do passo atual no celular", () => {
    const ASSISTENTE = ler("src/components/bex/assistente-em-passos.tsx");
    expect(ASSISTENTE).toContain("max-md:hidden max-md:group-data-[state=active]/step:block");
  });
});

describe("visão geral do WhatsApp", () => {
  it("seis indicadores em linha só a partir de 2xl, e as ações quebram linha", () => {
    const VISAO = ler("src/routes/_authenticated/whatsapp-visao-geral.tsx");
    expect(VISAO).toContain("md:grid-cols-3 2xl:grid-cols-6");
    // "2xl:grid-cols-6" contém "xl:grid-cols-6": só vale o xl sem o 2 na frente.
    expect(VISAO).not.toMatch(/[^2]xl:grid-cols-6/);
    expect(VISAO).toContain('<div className="flex flex-wrap gap-1.5">');
  });
});
