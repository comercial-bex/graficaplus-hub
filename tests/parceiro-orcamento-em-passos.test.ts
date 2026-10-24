import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PASSOS_DO_ORCAMENTO,
  ehUltimo,
  estadoDosPassos,
  passoAnterior,
  passoInicial,
  passoSeguinte,
  rotuloDoAvancar,
  type EntradaDosPassos,
} from "../src/domain/parceiros/passos-do-orcamento";
import {
  BarraDePassosDoOrcamento,
  PerguntaDoPasso,
} from "../src/components/parceiro/barra-de-passos";

/**
 * O orçamento do parceiro em passos (24/10/2026). Antes: uma página só, com
 * cliente, itens e resumo ao mesmo tempo. Agora: uma pergunta por passo, e a
 * conta de preço não mudou.
 */

const EDITOR = readFileSync("src/components/parceiro/editor-de-orcamento.tsx", "utf8");

const entrada = (o: Partial<EntradaDosPassos> = {}): EntradaDosPassos => ({
  clienteNome: "Mercado Boa Compra",
  titulo: "Banners da loja",
  itens: 2,
  itensSemDescricao: 0,
  pendencias: 0,
  vendaTotal: 180,
  validadeDias: 7,
  observacoes: "",
  ...o,
});

describe("os quatro passos", () => {
  it("são cliente, itens, condições e revisão, cada um com a sua pergunta", () => {
    expect(PASSOS_DO_ORCAMENTO.map((p) => p.titulo)).toEqual([
      "Cliente",
      "Itens",
      "Condições",
      "Revisão",
    ]);
    for (const p of PASSOS_DO_ORCAMENTO) expect(p.pergunta.length, p.titulo).toBeGreaterThan(10);
  });

  it("avançar e voltar param nas pontas", () => {
    expect(passoSeguinte(1)).toBe(2);
    expect(passoSeguinte(4)).toBe(4);
    expect(passoAnterior(1)).toBe(1);
    expect(passoAnterior(3)).toBe(2);
    expect(ehUltimo(4)).toBe(true);
    expect(ehUltimo(3)).toBe(false);
  });

  it("o botão diz para onde vai", () => {
    expect(rotuloDoAvancar(1)).toBe("Avançar: Itens");
    expect(rotuloDoAvancar(2)).toBe("Avançar: Condições");
    expect(rotuloDoAvancar(3)).toBe("Avançar: Revisão");
  });
});

describe("onde o orçamento abre", () => {
  it("sem itens, nos itens: cliente e assunto já vieram do diálogo Novo orçamento", () => {
    expect(passoInicial({ itens: 0, somenteLeitura: false, clientePreenchido: true })).toBe(2);
  });

  it("com itens, na revisão", () => {
    expect(passoInicial({ itens: 3, somenteLeitura: false, clientePreenchido: true })).toBe(4);
  });

  it("sem cliente, no cliente", () => {
    expect(passoInicial({ itens: 0, somenteLeitura: false, clientePreenchido: false })).toBe(1);
  });

  it("pedido já feito só se confere", () => {
    expect(passoInicial({ itens: 0, somenteLeitura: true, clientePreenchido: false })).toBe(4);
  });
});

describe("o que a barra mostra", () => {
  it("tudo certo: cliente, itens e revisão preenchidos; condições só com observação", () => {
    const e = estadoDosPassos(entrada());
    expect(e.map((x) => x.situacao)).toEqual(["preenchido", "preenchido", "vazio", "preenchido"]);
    expect(e[0].resumo).toBe("Mercado Boa Compra");
    expect(e[1].resumo).toContain("2 itens");
    expect(e[1].resumo).toContain("180,00");
    expect(e[2].resumo).toBe("vale 7 dias");
    expect(e[3].resumo).toBe("pronto para enviar");
  });

  it("observação preenche o passo das condições", () => {
    const e = estadoDosPassos(entrada({ observacoes: "Entrega em 5 dias" }));
    expect(e[2].situacao).toBe("preenchido");
    expect(e[2].resumo).toBe("vale 7 dias · com observações");
  });

  it("sem itens: itens vazios e revisão vazia, sem acusar problema", () => {
    const e = estadoDosPassos(entrada({ itens: 0, vendaTotal: 0 }));
    expect(e[1]).toMatchObject({ situacao: "vazio", resumo: "nenhum item" });
    expect(e[3]).toMatchObject({ situacao: "vazio", resumo: "sem itens" });
  });

  it("item sem descrição ou com pendência vira problema, e a revisão acompanha", () => {
    const e = estadoDosPassos(entrada({ itensSemDescricao: 1, pendencias: 1 }));
    expect(e[1].situacao).toBe("problema");
    expect(e[1].resumo).toBe("2 itens pedem atenção");
    expect(e[3]).toMatchObject({ situacao: "problema", resumo: "confira os itens" });
    expect(estadoDosPassos(entrada({ pendencias: 1 }))[1].resumo).toBe("1 item pede atenção");
  });

  it("sem nome do cliente ou sem assunto, o passo 1 pede o que falta", () => {
    expect(estadoDosPassos(entrada({ clienteNome: "  " }))[0].resumo).toBe("falta o cliente");
    expect(estadoDosPassos(entrada({ titulo: "" }))[0].resumo).toBe("falta o assunto");
    expect(estadoDosPassos(entrada({ clienteNome: "" }))[3].resumo).toBe("falta o cliente");
  });

  it("validade de 1 dia fica no singular", () => {
    expect(estadoDosPassos(entrada({ validadeDias: 1 }))[2].resumo).toBe("vale 1 dia");
  });
});

describe("a barra de passos", () => {
  const html = renderToStaticMarkup(
    createElement(BarraDePassosDoOrcamento, {
      atual: 2,
      estados: estadoDosPassos(entrada({ pendencias: 1 })),
      onIr: () => {},
    }),
  );

  it("tem um botão por passo e marca o passo atual", () => {
    expect((html.match(/<button/g) ?? []).length).toBe(4);
    expect(html).toContain('aria-current="step"');
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1);
  });

  it("mostra o nome de cada passo e o problema do passo dos itens", () => {
    for (const t of ["Cliente", "Itens", "Condições", "Revisão"]) expect(html).toContain(t);
    expect(html).toContain("1 item pede atenção");
  });

  it("a pergunta do passo vira o título da seção", () => {
    expect(renderToStaticMarkup(createElement(PerguntaDoPasso, { passo: 2 }))).toContain(
      "O que vai ser feito?",
    );
  });
});

describe("o editor do parceiro", () => {
  it("usa a barra e os quatro passos", () => {
    expect(EDITOR).toContain("BarraDePassosDoOrcamento");
    for (const n of [1, 2, 3, 4]) expect(EDITOR).toContain(`passo === ${n}`);
  });

  it("não perde o que já fazia: PDF, pedido, duplicar e salvar", () => {
    for (const trecho of [
      "baixarPdf",
      "abrirPedido",
      "duplicar",
      "PedidoDialog",
      "async function salvar",
    ]) {
      expect(EDITOR).toContain(trecho);
    }
  });

  it("o passo inicial vale só na primeira carga (não pula de passo ao salvar o primeiro item)", () => {
    expect(EDITOR).toMatch(/setPassoEscolhido\(\s*\(atual\) =>\s*atual \?\?/);
  });

  it("a conta de preço continua vindo do domínio, sem soma nova na tela", () => {
    expect(EDITOR).toContain("resumoDoOrcamento(itens, porProduto)");
    expect(EDITOR).toContain("vendaDoItem(");
  });
});
