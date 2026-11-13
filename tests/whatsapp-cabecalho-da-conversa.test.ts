import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { oQueDaPraFazer } from "../src/domain/whatsapp/acoes-de-trabalho";
import {
  LARGURA_MINIMA_PARA_ICONES,
  LARGURA_MINIMA_PARA_ORCAMENTO_NO_BOTAO,
  LARGURA_MINIMA_PARA_TEXTO,
  apresentacaoDosBotoes,
  acoesDoCabecalho,
  type EntradaDoCabecalho,
} from "../src/domain/whatsapp/acoes-do-cabecalho";

/**
 * O cabeçalho da conversa (onda 1, 12/11/2026, dono CONVERSA): "toda ação que
 * existe hoje continua existindo" (contrato, 6.1). A regra de quem aparece onde
 * é pura e está aqui; o desenho se prende lendo o código.
 */

const tudo = oQueDaPraFazer({ podeResponder: true, podeOrcar: true, podeAbrirOs: true, clienteId: "c1" });
const base: EntradaDoCabecalho = {
  temPermissaoDeResponder: true,
  status: "aberta",
  responsavelId: null,
  meuId: "eu",
  modo: "medio",
  larguraDaConversa: 700,
  iaLigada: false,
  modoDaConversa: "humano",
  disponivel: tudo,
};
const com = (extra: Partial<EntradaDoCabecalho>) => acoesDoCabecalho({ ...base, ...extra });

describe("Assumir", () => {
  it("só quando não há responsável ou é de outra pessoa; de outra pessoa pede confirmação", () => {
    expect(com({ responsavelId: null }).assumir).toBe("direto");
    expect(com({ responsavelId: "outra" }).assumir).toBe("confirmar");
    expect(com({ responsavelId: "eu" }).assumir).toBe("nenhum");
  });
  it("quem só lê não assume", () => {
    expect(com({ temPermissaoDeResponder: false }).assumir).toBe("nenhum");
  });
});

describe("Resolver, Reabrir e o menu", () => {
  it("Resolver na conversa em andamento; Reabrir quando resolvida ou arquivada", () => {
    expect(com({ status: "aberta" }).situacao).toBe("resolver");
    expect(com({ status: "pendente" }).situacao).toBe("resolver");
    expect(com({ status: "resolvida" }).situacao).toBe("reabrir");
    expect(com({ status: "arquivada" }).situacao).toBe("reabrir");
    expect(com({ temPermissaoDeResponder: false }).situacao).toBeNull();
  });
  it("Marcar pendente vira Tirar de pendente; Arquivar some na arquivada", () => {
    expect(com({ status: "aberta" }).pendente).toBe("marcar");
    expect(com({ status: "pendente" }).pendente).toBe("tirar");
    expect(com({ status: "resolvida" }).pendente).toBeNull();
    expect(com({ status: "aberta" }).arquivar).toBe(true);
    expect(com({ status: "arquivada" }).arquivar).toBe(false);
  });
  it("Transferir está no menu de quem responde", () => {
    expect(com({}).transferir).toBe(true);
    expect(com({ temPermissaoDeResponder: false }).transferir).toBe(false);
  });
  it("Devolver à assistente só com a assistente ligada e a conversa com a equipe", () => {
    expect(com({ iaLigada: false }).devolverAAssistente).toBe(false);
    expect(com({ iaLigada: true, modoDaConversa: "humano" }).devolverAAssistente).toBe(true);
    expect(com({ iaLigada: true, modoDaConversa: "auto", responsavelId: null }).devolverAAssistente).toBe(false);
    expect(com({ iaLigada: true, modoDaConversa: "auto", responsavelId: "outra" }).devolverAAssistente).toBe(true);
    expect(com({ iaLigada: true, status: "resolvida" }).devolverAAssistente).toBe(false);
  });
});

describe("Orçamento: à vista no médio e no largo, no menu no estreito", () => {
  it("o botão aparece quando a conversa tem 520 px ou mais e o modo não é estreito", () => {
    expect(LARGURA_MINIMA_PARA_ORCAMENTO_NO_BOTAO).toBe(520);
    expect(com({ modo: "medio", larguraDaConversa: 632 })).toMatchObject({ orcamentoNoBotao: true, orcamentoNoMenu: false });
    expect(com({ modo: "largo", larguraDaConversa: 872 }).orcamentoNoBotao).toBe(true);
    // Largo com os dados encaixados (conversa de 560 px): o Orçamento fica à vista, só com o ícone.
    expect(com({ modo: "largo", larguraDaConversa: 560 })).toMatchObject({ orcamentoNoBotao: true, apresentacao: "icones" });
  });
  it("o Orçamento vai para o menu no estreito e quando a conversa é estreita (519 px ou menos)", () => {
    expect(com({ modo: "estreito", larguraDaConversa: 704 })).toMatchObject({ orcamentoNoBotao: false, orcamentoNoMenu: true });
    expect(com({ modo: "medio", larguraDaConversa: 519 })).toMatchObject({ orcamentoNoBotao: false, orcamentoNoMenu: true });
    expect(com({ modo: "medio", larguraDaConversa: 520 }).orcamentoNoBotao).toBe(true);
  });
  it("sem a medida ainda, tratada como larga (não pisca o botão para o menu)", () => {
    expect(com({ modo: "medio", larguraDaConversa: null }).orcamentoNoBotao).toBe(true);
  });
  it("sem permissão de orçar o item fica no menu, desabilitado e com o motivo, nunca some", () => {
    const sem = oQueDaPraFazer({ podeResponder: true, podeOrcar: false, podeAbrirOs: false, clienteId: null });
    const a = com({ disponivel: sem });
    expect(a.orcamentoNoBotao).toBe(false);
    expect(a.orcamentoNoMenu).toBe(true);
    expect(sem.orcamento).toMatchObject({ pode: false });
  });
});

describe("a tela do cabeçalho", () => {
  const CABECALHO = readFileSync("src/components/whatsapp/cabecalho-da-conversa.tsx", "utf8");

  it("linha de 64 px e Voltar só no modo estreito", () => {
    expect(CABECALHO).toContain('"flex h-16 shrink-0 items-center gap-2 border-b px-2"');
    expect(CABECALHO).toContain('p.modo === "estreito" && (');
    expect(CABECALHO).toContain('aria-label="Voltar às conversas"');
  });

  it("toda ação do menu de três pontos existe", () => {
    for (const rotulo of [
      "Transferir",
      "Marcar pendente",
      "Tirar de pendente",
      "Arquivar",
      "Criar orçamento",
      "Criar OS",
      "Vincular a um cliente",
      "Dados do contato",
      "Devolver à assistente",
      "Atalhos do teclado",
    ])
      expect(CABECALHO, rotulo).toContain(rotulo);
    expect(CABECALHO).toContain("Buscar na conversa");
    expect(CABECALHO).toContain("Mais ações da conversa");
  });

  it("assumir a conversa de outra pessoa passa por ConfirmarAcao", () => {
    expect(CABECALHO).toContain("<ConfirmarAcao");
    expect(CABECALHO).toContain("aoConfirmar={p.onAssumir}");
  });

  it("o motivo de quem não pode aparece junto do item desabilitado, em texto de 15 px", () => {
    expect(CABECALHO).toContain("disabled={!v.pode}");
    expect(CABECALHO).toMatch(/\{v\.motivo\}/);
  });

  it("a busca fecha com Esc consumindo o evento e anda com Enter e Shift+Enter", () => {
    expect(CABECALHO).toMatch(/e\.key === "Escape"\) \{\s*e\.preventDefault\(\);\s*onFechar\(\);/);
    expect(CABECALHO).toContain("if (e.shiftKey) onAnterior();");
  });
});

describe("o nome do contato nunca some (revisão da onda 1, 12/11/2026)", () => {
  // Larguras fixas do cabeçalho, em px: padding 16, foto 40 + 10 de vão, botões de ícone 44, vão 8.
  const BASE = 16 + 40 + 10;
  const ICONE = 44;
  const VAO = 8;
  const TEXTO = { assumir: 112, resolver: 115, orcamento: 125 };

  /** Quanto sobra para o nome, somando o que a apresentação deixa à vista. */
  function sobraParaONome(
    largura: number,
    modo: "estreito" | "medio" | "largo",
    quando: Partial<EntradaDoCabecalho> = {},
  ): number {
    const a = com({ modo, larguraDaConversa: largura, responsavelId: null, ...quando });
    let fixo = BASE + 2 * ICONE; // lupa e três pontos
    let itens = 3; // nome, lupa, menu
    if (modo === "estreito") {
      fixo += ICONE;
      itens += 1;
    }
    const botoes = [a.assumir !== "nenhum" && !a.situacaoNoMenu, a.situacao !== null && !a.situacaoNoMenu, a.orcamentoNoBotao];
    const chaves = ["assumir", "resolver", "orcamento"] as const;
    botoes.forEach((aparece, i) => {
      if (!aparece) return;
      fixo += a.apresentacao === "texto" ? TEXTO[chaves[i]] : ICONE;
      itens += 1;
    });
    return largura - fixo - VAO * (itens - 1);
  }

  it("a 375 px (estreito, conversa sem responsável ou de outra pessoa) só ficam Voltar, nome, lupa e menu", () => {
    for (const responsavelId of [null, "outra", "eu"]) {
      const a = com({ modo: "estreito", larguraDaConversa: 373, responsavelId });
      expect(a.apresentacao).toBe("so_menu");
      expect(a.situacaoNoMenu).toBe(true);
      expect(a.orcamentoNoBotao).toBe(false);
      expect(sobraParaONome(373, "estreito", { responsavelId }), String(responsavelId)).toBeGreaterThanOrEqual(120);
    }
  });

  it("de 360 a 2200 px de conversa o nome tem pelo menos 120 px, em qualquer modo e com qualquer responsável", () => {
    for (let largura = 360; largura <= 2200; largura += 20) {
      const modo = largura < 520 ? "estreito" : largura < 900 ? "medio" : "largo";
      for (const responsavelId of [null, "outra", "eu"]) {
        expect(sobraParaONome(largura, modo, { responsavelId }), `${modo} ${largura} ${responsavelId}`).toBeGreaterThanOrEqual(120);
      }
    }
    // E no médio logo abaixo do limite de texto (759) e logo abaixo do de ícones (519).
    for (const largura of [440, 519, 520, 600, 759, 760, 900]) {
      expect(sobraParaONome(largura, "medio", { responsavelId: "outra" }), String(largura)).toBeGreaterThanOrEqual(120);
    }
  });

  it("limites: abaixo de 520 só o menu; de 520 a 759 ícones de 44 px; de 760 com texto", () => {
    expect(LARGURA_MINIMA_PARA_ICONES).toBe(520);
    expect(LARGURA_MINIMA_PARA_TEXTO).toBe(760);
    expect(apresentacaoDosBotoes("medio", 519)).toBe("so_menu");
    expect(apresentacaoDosBotoes("medio", 520)).toBe("icones");
    expect(apresentacaoDosBotoes("medio", 759)).toBe("icones");
    expect(apresentacaoDosBotoes("medio", 760)).toBe("texto");
    expect(apresentacaoDosBotoes("estreito", 1000)).toBe("so_menu");
    expect(apresentacaoDosBotoes("largo", null)).toBe("texto");
  });

  it("toda ação continua alcançável: o que sai da vista entra no menu de três pontos", () => {
    const CABECALHO = readFileSync("src/components/whatsapp/cabecalho-da-conversa.tsx", "utf8");
    expect(CABECALHO).toContain("a.situacaoNoMenu && a.assumir !== \"nenhum\"");
    expect(CABECALHO).toContain('a.situacaoNoMenu && a.situacao === "resolver"');
    expect(CABECALHO).toContain('a.situacaoNoMenu && a.situacao === "reabrir"');
    // Assumir a conversa de outra pessoa pelo menu também passa por confirmação.
    expect(CABECALHO).toContain("setConfirmandoAssumir(true)");
    // O botão do nome encolhe; os de ação nunca (shrink-0), e o texto só no modo "texto".
    expect(CABECALHO).toContain('cn("h-11 shrink-0", comTexto ? "px-3 text-sm" : "w-11 px-0")');
    expect(CABECALHO).not.toContain("classeDoBotao");
  });
});
