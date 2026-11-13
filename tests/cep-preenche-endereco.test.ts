import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizarRespostaCEP } from "../src/lib/api/cep.server";
import { preencherEnderecoDoCep } from "../src/domain/clientes/ficha-do-cliente";
import { CampoDeCep } from "../src/components/cliente/campo-de-cep";

/**
 * CEP que preenche o endereço (01/11/2026): é o que sobra de "puxar corretamente" para quem é pessoa
 * física, que não tem consulta de documento. O número da casa a pessoa digita depois.
 */

describe("a resposta da consulta de CEP", () => {
  it("lê a BrasilAPI (rua, bairro, cidade e estado)", () => {
    expect(
      normalizarRespostaCEP("68900073", { cep: "68900073", street: "Avenida FAB", neighborhood: "Central", city: "Macapá", state: "AP" }),
    ).toEqual({ cep: "68900073", endereco: "Avenida FAB", bairro: "Central", cidade: "Macapá", estado: "AP" });
  });

  it("lê o ViaCEP, que usa outros nomes, e põe o estado em maiúsculas", () => {
    expect(
      normalizarRespostaCEP("68900073", { cep: "68900-073", logradouro: "Avenida FAB", bairro: "Central", localidade: "Macapá", uf: "ap" }),
    ).toEqual({ cep: "68900073", endereco: "Avenida FAB", bairro: "Central", cidade: "Macapá", estado: "AP" });
  });

  it("texto vazio vira nulo, e sem CEP na resposta vale o que foi consultado", () => {
    expect(normalizarRespostaCEP("68900073", { street: "  ", neighborhood: "" })).toEqual({
      cep: "68900073",
      endereco: null,
      bairro: null,
      cidade: null,
      estado: null,
    });
  });
});

describe("o que o CEP preenche", () => {
  const dados = { endereco: "Avenida FAB", bairro: "Central", cidade: "Macapá", estado: "AP" };

  it("preenche o que está vazio", () => {
    expect(preencherEnderecoDoCep({ endereco: "", bairro: null, cidade: undefined, estado: "" }, dados)).toMatchObject(dados);
  });

  it("não troca o que a pessoa já escreveu, com número e complemento", () => {
    const r = preencherEnderecoDoCep({ endereco: "Av. FAB, 1200, sala 3", bairro: "Centro", cidade: "", estado: "" }, dados);
    expect(r.endereco).toBe("Av. FAB, 1200, sala 3");
    expect(r.bairro).toBe("Centro");
    expect(r.cidade).toBe("Macapá");
    expect(r.estado).toBe("AP");
  });

  it("não perde os outros campos do cadastro", () => {
    const r = preencherEnderecoDoCep({ nome: "Gráfica", endereco: "" } as { nome: string; endereco: string }, dados);
    expect(r.nome).toBe("Gráfica");
  });
});

describe("o campo de CEP", () => {
  const html = (valor: string) =>
    renderToStaticMarkup(createElement(CampoDeCep, { id: "c", valor, onValorChange: () => {}, onEncontrado: () => {} }));

  it("tem rótulo, máscara e o botão de buscar pelo nome", () => {
    const h = html("");
    expect(h.includes("CEP")).toBe(true);
    expect(h.includes('placeholder="00000-000"')).toBe(true);
    expect(h.includes('aria-label="Buscar o endereço pelo CEP"')).toBe(true);
  });

  it("o botão só liga com os 8 números", () => {
    // `disabled=""` é o atributo; as classes `disabled:...` do botão não contam
    expect(html("68900").includes('disabled=""')).toBe(true);
    expect(html("68900-073").includes('disabled=""')).toBe(false);
  });
});

describe("as telas e o servidor", () => {
  const LISTA = readFileSync("src/routes/_authenticated/clientes.index.tsx", "utf8");
  const FICHA = readFileSync("src/routes/_authenticated/clientes.$id.tsx", "utf8");
  const GUIADO = readFileSync("src/components/cliente/novo-cliente-em-passos.tsx", "utf8");
  const SERVIDOR = readFileSync("src/lib/api/cep.server.ts", "utf8");

  it("os três cadastros usam o CEP que preenche, e quem é de fora vê código postal livre", () => {
    for (const [nome, fonte] of [["cadastro completo", LISTA], ["edição", FICHA], ["guiado", GUIADO]] as const) {
      expect(fonte.includes("<CampoDeCep"), nome).toBe(true);
      expect(fonte.includes("preencherEnderecoDoCep("), nome).toBe(true);
      expect(fonte.includes("Código postal"), nome).toBe(true);
    }
  });

  it("o servidor tenta a BrasilAPI e cai para o ViaCEP, com User-Agent e prazo", () => {
    expect(SERVIDOR).toContain("https://brasilapi.com.br/api/cep/v2/");
    expect(SERVIDOR).toContain("https://viacep.com.br/ws/");
    expect(SERVIDOR).toContain('"User-Agent"');
    // o prazo é parâmetro desde 13/11/2026 (a triagem do WhatsApp usa um mais curto); o padrão da tela continua 6 s
    expect(SERVIDOR).toContain("tempoMs = 6000");
    expect(SERVIDOR).toContain("setTimeout(() => controlador.abort(), tempoMs)");
    // CEP que a BrasilAPI diz não existir (404) não vai para a segunda consulta
    expect(SERVIDOR).toContain("a.status !== 404");
  });
});
