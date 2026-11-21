import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * O quadro "Vá até" renderiza no servidor, sem navegador e sem roteador (21/11/2026). O Link do roteador vira um
 * <a> que mostra para onde levaria: a rota, os parâmetros e a busca.
 */
vi.mock("@tanstack/react-router", async (original) => {
  const real = await original<typeof import("@tanstack/react-router")>();
  return {
    ...real,
    Link: ({ to, params, search, children, ...resto }: { to: string; params?: unknown; search?: unknown; children?: unknown }) =>
      createElement(
        "a",
        {
          "data-to": to,
          "data-params": params ? JSON.stringify(params) : undefined,
          "data-search": search ? JSON.stringify(search) : undefined,
          ...resto,
        },
        children as never,
      ),
  };
});

import { OndeCorrigir } from "../src/components/produtos/onde-corrigir";
import { ondeCorrigirAviso, ondeCorrigirFalta } from "../src/domain/precos/onde-corrigir";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
// O JSON dentro de atributo HTML vem com aspas escapadas.
const atributo = (nome: string, valor: unknown) => `${nome}="${JSON.stringify(valor).replace(/"/g, "&quot;")}"`;

describe("o quadro Vá até, renderizado", () => {
  it("dentro da pasta: um botão que chama a troca de aba, com a frase em destaque e o custo digitado", () => {
    const h = html(
      createElement(OndeCorrigir, {
        onde: ondeCorrigirFalta("sem_materia_prima", { custoDigitado: 400 }),
        produtoId: "p1",
        aoIrParaCampo: () => {},
      }),
    );
    expect(h).toContain('data-testid="onde-corrigir"');
    expect(h).toContain("Vá até a aba Parâmetros desta pasta, no cartão Materiais deste produto.");
    expect(h).toContain("400,00");
    expect(h).toContain("<button");
    expect(h).toContain("Ir para Materiais deste produto");
    expect(h).not.toContain("<a ");
  });

  it("fora da pasta: link para a pasta do produto, já na aba e no campo", () => {
    const h = html(createElement(OndeCorrigir, { onde: ondeCorrigirFalta("sem_tempo"), produtoId: "p1" }));
    expect(h).toContain('data-to="/produtos/$id"');
    expect(h).toContain(atributo("data-params", { id: "p1" }));
    expect(h).toContain(atributo("data-search", { aba: "parametros", campo: "pasta-tempo" }));
    expect(h).toContain('data-testid="onde-corrigir-botao"');
    expect(h).not.toContain("<button");
  });

  it("mão de obra leva à Planilha de custos, aba Mão de obra", () => {
    const h = html(createElement(OndeCorrigir, { onde: ondeCorrigirFalta("sem_mao_de_obra"), produtoId: "p1" }));
    expect(h).toContain('data-to="/planilha-custos"');
    expect(h).toContain(atributo("data-search", { aba: "mao-obra" }));
    expect(h).toContain("Vá até o módulo Planilha de custos, aba Mão de obra.");
  });

  it("outro módulo: material, máquina e custos fixos abrem a rota certa", () => {
    for (const [codigo, rota] of [
      ["material_sem_custo", "/materiais"],
      ["tempo_presumido", "/maquinas"],
      ["custo_incompleto", "/custos-producao"],
    ] as const) {
      const h = html(createElement(OndeCorrigir, { onde: ondeCorrigirAviso(codigo)!, letraGrande: true }));
      expect(h, codigo).toContain(`data-to="${rota}"`);
    }
  });

  it("sem id de produto, a falta da pasta não tem botão, mas a frase continua dizendo onde ir", () => {
    const h = html(createElement(OndeCorrigir, { onde: ondeCorrigirFalta("sem_maquina") }));
    expect(h).toContain("Vá até a aba Parâmetros");
    expect(h).not.toContain("<a ");
    expect(h).not.toContain("<button");
  });

  it("aviso de preço: só a frase e o que fazer, sem botão, e em letra de 16 px no painel de preços", () => {
    const h = html(createElement(OndeCorrigir, { onde: ondeCorrigirAviso("abaixo_do_custo")!, produtoId: "p1", letraGrande: true }));
    expect(h).toContain("Corrija aqui mesmo, no campo do preço de balcão deste produto.");
    expect(h).toContain("O gerente aprova");
    expect(h).not.toContain("<a ");
    expect(h).not.toContain("<button");
    expect(h).not.toMatch(/[\s"]text-(xs|sm)[\s"]/);
    // Na pasta do produto, a linha do que fazer é menor que a frase em destaque.
    const naPasta = html(createElement(OndeCorrigir, { onde: ondeCorrigirFalta("sem_tempo"), produtoId: "p1", aoIrParaCampo: () => {} }));
    expect(naPasta).toContain("text-sm");
  });

  it("nenhum quadro tem parênteses, travessão ou seta, que é como o dono lê", () => {
    for (const chave of ["sem_materia_prima", "custo_digitado", "sem_tempo", "sem_maquina", "sem_mao_de_obra"] as const) {
      const h = html(
        createElement(OndeCorrigir, {
          onde: ondeCorrigirFalta(chave, { custoDigitado: 400 }),
          produtoId: "p1",
          aoIrParaCampo: () => {},
        }),
      );
      expect(h, chave).not.toMatch(/[()—–→←]/);
    }
  });
});
