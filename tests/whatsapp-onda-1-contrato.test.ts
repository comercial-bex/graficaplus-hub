import { describe, expect, it } from "vitest";
import {
  LARGURA_MINIMA_DA_CONVERSA,
  LIMITES_DA_CAIXA,
  larguraDaConversa,
  modoPelaLargura,
} from "../src/domain/whatsapp/moldura";
import { oQueDaPraFazer } from "../src/domain/whatsapp/acoes-de-trabalho";
import {
  partesComRealce,
  rotuloDoTique,
  tiqueDaMensagem,
} from "../src/domain/whatsapp/linha-do-tempo";
import { ATALHOS_DO_TECLADO, escFechaAConversa } from "../src/domain/whatsapp/teclado";
import { previaDaConversa, type MensagemDaCaixa } from "../src/domain/whatsapp/caixa-de-entrada";
import { bolhaSemFundo, fotosDaConversa } from "../src/domain/whatsapp/midia";
import {
  gravarRascunho,
  lerRascunho,
  resumoDoRascunho,
} from "../src/components/whatsapp/rascunhos";

/**
 * O contrato entre os quatro construtores da onda 1 da caixa do WhatsApp
 * (12/11/2026): MOLDURA, CONVERSA, MIDIA e GAVETA. Cada função daqui é de um
 * dono e usada por OUTRO; esta trava não é de nenhum dos quatro. Mudar o que
 * ela prende é mudar o contrato: vai no relatório, não no código.
 * O contrato inteiro: scratchpad/whatsapp-onda-1/contrato.md.
 */

const SEM_TRAVESSAO_NEM_SETA = /[—–→←⇒]/;

describe("MOLDURA → CONVERSA e GAVETA: o modo pela largura útil da área", () => {
  it("os limites são 840 e 1280 px", () => {
    expect(LIMITES_DA_CAIXA).toEqual({ medio: 840, largo: 1280 });
  });

  it("as larguras medidas no laboratório de 11/11 (menu aberto 328 px, recolhido 64 px)", () => {
    const casos: [string, number, string][] = [
      ["375 celular", 375, "estreito"],
      ["768 menu aberto", 440, "estreito"],
      ["1024 menu aberto", 696, "estreito"],
      ["768 menu recolhido", 704, "estreito"],
      ["1180 menu aberto", 852, "medio"],
      ["1280 menu aberto", 952, "medio"],
      ["1024 menu recolhido", 960, "medio"],
      ["1366 menu aberto", 1038, "medio"],
      ["1440 menu aberto", 1112, "medio"],
      ["1180 menu recolhido", 1116, "medio"],
      ["1280 menu recolhido", 1216, "medio"],
      ["1366 menu recolhido", 1302, "largo"],
      ["1440 menu recolhido", 1376, "largo"],
      ["1920 menu aberto", 1592, "largo"],
      ["1920 menu recolhido", 1856, "largo"],
    ];
    for (const [nome, px, modo] of casos) expect(modoPelaLargura(px), nome).toBe(modo);
    expect(modoPelaLargura(839)).toBe("estreito");
    expect(modoPelaLargura(840)).toBe("medio");
    expect(modoPelaLargura(1279)).toBe("medio");
    expect(modoPelaLargura(1280)).toBe("largo");
    expect(modoPelaLargura(Number.NaN)).toBe("estreito");
  });
});

describe("MOLDURA: a conversa não é espremida em nenhuma largura útil", () => {
  it("de 440 a 1920 px úteis, a conversa tem 520 px ou mais (ou a tela inteira, no modo estreito)", () => {
    for (let util = 320; util <= 2200; util += 1) {
      for (const gaveta of [false, true]) {
        const w = larguraDaConversa(util, gaveta);
        if (modoPelaLargura(util) === "estreito") expect(w, `${util}`).toBe(util);
        else expect(w, `${util} gaveta ${gaveta}`).toBeGreaterThanOrEqual(LARGURA_MINIMA_DA_CONVERSA);
      }
    }
  });

  it("o caso do print: 1280 px de janela com o menu aberto (952 px úteis) dá 632 px de conversa, não 244", () => {
    expect(larguraDaConversa(952, false)).toBe(632);
    expect(larguraDaConversa(952, true)).toBe(632);
    expect(larguraDaConversa(1592, true)).toBe(872);
    expect(larguraDaConversa(1280, true)).toBe(560);
  });
});

describe("GAVETA → CONVERSA: o que dá para fazer com a conversa", () => {
  it("tudo liberado para quem pode, com cliente", () => {
    const r = oQueDaPraFazer({
      podeResponder: true,
      podeOrcar: true,
      podeAbrirOs: true,
      clienteId: "c",
    });
    expect(r).toEqual({
      orcamento: { pode: true },
      os: { pode: true },
      vincular_cliente: { pode: true },
    });
  });

  it("o motivo aparece no lugar do botão, sem travessão", () => {
    const r = oQueDaPraFazer({
      podeResponder: false,
      podeOrcar: false,
      podeAbrirOs: true,
      clienteId: null,
    });
    for (const d of Object.values(r)) {
      expect(d.pode).toBe(false);
      if (!d.pode) expect(d.motivo).not.toMatch(SEM_TRAVESSAO_NEM_SETA);
    }
    expect(r.os.pode === false && r.os.motivo).toContain("Vincule a conversa a um cliente");
    const semOs = oQueDaPraFazer({
      podeResponder: true,
      podeOrcar: true,
      podeAbrirOs: false,
      clienteId: "c",
    });
    expect(semOs.os.pode === false && semOs.os.motivo).toContain(
      "Abrir OS direto é do administrador",
    );
  });
});

describe("CONVERSA → MOLDURA: o tique, o rascunho e o Esc", () => {
  it("tique só na mensagem da empresa, pela situação; nunca inventado", () => {
    expect(tiqueDaMensagem({ direcao: "entrada", status: "recebida" })).toBeNull();
    expect(tiqueDaMensagem({ direcao: "saida", status: "pendente" })).toBe("relogio");
    expect(tiqueDaMensagem({ direcao: "saida", status: "enviada" })).toBe("enviada");
    expect(tiqueDaMensagem({ direcao: "saida", status: "entregue" })).toBe("entregue");
    expect(tiqueDaMensagem({ direcao: "saida", status: "lida" })).toBe("lida");
    expect(tiqueDaMensagem({ direcao: "saida", status: "falha" })).toBe("falha");
    expect(tiqueDaMensagem({ direcao: "saida", status: "qualquer" })).toBeNull();
    expect(rotuloDoTique("lida")).toBe("lida pelo cliente");
    for (const t of ["relogio", "enviada", "entregue", "lida", "falha"] as const) {
      expect(rotuloDoTique(t)).not.toMatch(SEM_TRAVESSAO_NEM_SETA);
    }
  });

  it("o rascunho é por conversa, guarda o espaço que se digitou e some quando fica vazio", () => {
    gravarRascunho("conversa-a", "Bom dia, segue o valor");
    gravarRascunho("conversa-b", "outra");
    expect(lerRascunho("conversa-a")).toBe("Bom dia, segue o valor");
    expect(lerRascunho("conversa-b")).toBe("outra");
    gravarRascunho("conversa-a", "  ");
    expect(lerRascunho("conversa-a")).toBe("  ");
    expect(resumoDoRascunho("  ")).toBe("");
    gravarRascunho("conversa-a", "");
    expect(lerRascunho("conversa-a")).toBe("");
    expect(lerRascunho("nunca-escrita")).toBe("");
    expect(resumoDoRascunho("\nprimeira linha\nsegunda")).toBe("primeira linha");
    expect(resumoDoRascunho("x".repeat(80), 10)).toHaveLength(10);
  });

  it("o Esc só fecha a conversa quando ninguém o consumiu e não há camada por cima", () => {
    const vazio = { querySelector: () => null };
    const comDialogo = { querySelector: () => ({}) as Element };
    expect(escFechaAConversa({ key: "Escape", defaultPrevented: false }, vazio)).toBe(true);
    expect(escFechaAConversa({ key: "Escape", defaultPrevented: true }, vazio)).toBe(false);
    expect(escFechaAConversa({ key: "Escape", defaultPrevented: false }, comDialogo)).toBe(false);
    expect(
      escFechaAConversa({ key: "Escape", defaultPrevented: false, isComposing: true }, vazio),
    ).toBe(false);
    expect(escFechaAConversa({ key: "Enter", defaultPrevented: false }, vazio)).toBe(false);
  });

  it("a lista de atalhos não tem travessão nem seta, nem letra solta que faça ação", () => {
    for (const a of ATALHOS_DO_TECLADO) {
      expect(`${a.teclas} ${a.faz}`).not.toMatch(SEM_TRAVESSAO_NEM_SETA);
      expect(a.teclas).not.toMatch(/^[A-Z]$/);
    }
  });
});

describe("CONVERSA → MIDIA: o realce da busca na conversa", () => {
  it("marca os trechos sem diferenciar acento nem maiúscula, e devolve o texto inteiro", () => {
    const partes = partesComRealce("Orçamento do ORÇAMENTO", "orcamento");
    expect(partes.map((p) => p.texto).join("")).toBe("Orçamento do ORÇAMENTO");
    expect(partes.filter((p) => p.realce).map((p) => p.texto)).toEqual(["Orçamento", "ORÇAMENTO"]);
    expect(partesComRealce("sem nada", "")).toEqual([{ texto: "sem nada", realce: false }]);
    expect(partesComRealce("sem nada", null)).toEqual([{ texto: "sem nada", realce: false }]);
  });
});

describe("MIDIA → MOLDURA e CONVERSA: prévia da lista, figurinha e fotos", () => {
  it("a prévia diz o tipo (para o ícone) e o texto sem colchete", () => {
    expect(previaDaConversa("[imagem]")).toEqual({ tipo: "imagem", texto: "Foto" });
    expect(previaDaConversa("[Imagem]")).toEqual({ tipo: "imagem", texto: "Foto" });
    expect(previaDaConversa("[audio]")).toEqual({ tipo: "audio", texto: "Áudio" });
    expect(previaDaConversa("[Documento]").tipo).toBe("documento");
    expect(previaDaConversa("[video]").tipo).toBe("video");
    expect(previaDaConversa("Bom dia")).toEqual({ tipo: "texto", texto: "Bom dia" });
    expect(previaDaConversa(null).tipo).toBe("vazia");
    expect(previaDaConversa("[sistema]").tipo).toBe("sistema");
  });

  it("figurinha sem fundo de bolha; o visor anda nas fotos da conversa, da mais antiga à mais nova", () => {
    expect(bolhaSemFundo({ tipo: "sticker" })).toBe(true);
    expect(bolhaSemFundo({ tipo: "imagem" })).toBe(false);
    const base: MensagemDaCaixa = {
      id: "1",
      direcao: "entrada",
      tipo: "imagem",
      status: "recebida",
      texto: null,
      legenda: null,
      media_url: "https://x.exemplo/a.jpg",
      storage_bucket: null,
      storage_path: null,
      erro: null,
      recebido_em: "2026-11-12T10:00:00Z",
      enviado_em: null,
      created_at: "2026-11-12T10:00:00Z",
    };
    const lista = [
      { ...base, id: "nova", recebido_em: "2026-11-12T11:00:00Z" },
      { ...base, id: "velha", recebido_em: "2026-11-12T09:00:00Z" },
      { ...base, id: "texto", tipo: "texto", media_url: null },
      { ...base, id: "figurinha", tipo: "sticker" },
      { ...base, id: "sem-arquivo", media_url: null },
    ];
    expect(fotosDaConversa(lista).map((m) => m.id)).toEqual(["velha", "nova"]);
  });
});
