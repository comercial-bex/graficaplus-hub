import { describe, expect, it } from "vitest";
import {
  ALTURA_MINIMA_DA_CAIXA_PX,
  ATALHOS_DO_TECLADO,
  LINHAS_DA_CAIXA,
  alturaDaCaixa,
  andarNaLista,
  haCamadaPorCima,
  letraVaiParaACaixa,
  oQueATeclaFazNaLista,
  oQueOEnterFaz,
  precisaConfirmarBarra,
  type Tecla,
} from "../src/domain/whatsapp/teclado";

/**
 * O teclado da caixa do WhatsApp no jeito do WhatsApp (onda 1, 12/11/2026, dono
 * CONVERSA). A tabela inteira do Enter, a lista do "/" e a letra que vai para a
 * caixa. O que mais importa: com a lista do "/" aberta o Enter NUNCA envia, e
 * "/pix" mais Ctrl+Enter nunca vai ao cliente sem confirmação (no laboratório de
 * 11/11 foi ao cliente literal).
 */

const tecla = (key: string, extra: Partial<Tecla> = {}): Tecla => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});
const onde = (texto: string, extra: Partial<Parameters<typeof oQueOEnterFaz>[1]> = {}) => ({
  listaDaBarraAberta: false,
  toque: false,
  texto,
  ...extra,
});

describe("o Enter na caixa de resposta", () => {
  it("Enter envia; Shift+Enter e Alt+Enter quebram a linha; Ctrl+Enter e Cmd+Enter também enviam", () => {
    expect(oQueOEnterFaz(tecla("Enter"), onde("oi"))).toBe("enviar");
    expect(oQueOEnterFaz(tecla("Enter", { shiftKey: true }), onde("oi"))).toBe("quebrar_linha");
    expect(oQueOEnterFaz(tecla("Enter", { altKey: true }), onde("oi"))).toBe("quebrar_linha");
    expect(oQueOEnterFaz(tecla("Enter", { ctrlKey: true }), onde("oi"))).toBe("enviar");
    expect(oQueOEnterFaz(tecla("Enter", { metaKey: true }), onde("oi"))).toBe("enviar");
  });

  it("no aparelho de toque o Enter quebra a linha; Ctrl+Enter de teclado externo ainda envia", () => {
    expect(oQueOEnterFaz(tecla("Enter"), onde("oi", { toque: true }))).toBe("quebrar_linha");
    expect(oQueOEnterFaz(tecla("Enter", { ctrlKey: true }), onde("oi", { toque: true }))).toBe("enviar");
  });

  it("durante a composição de acento o Enter nunca envia (isComposing e keyCode 229)", () => {
    expect(oQueOEnterFaz(tecla("Enter", { isComposing: true }), onde("oi"))).toBe("deixar");
    expect(oQueOEnterFaz(tecla("Enter", { keyCode: 229 }), onde("oi"))).toBe("deixar");
    expect(oQueOEnterFaz(tecla("Enter", { ctrlKey: true, isComposing: true }), onde("oi"))).toBe("deixar");
  });

  it("outra tecla não é do Enter", () => {
    expect(oQueOEnterFaz(tecla("a"), onde("oi"))).toBe("deixar");
    expect(oQueOEnterFaz(tecla("Tab"), onde("oi"))).toBe("deixar");
  });

  it("caixa vazia ou só com espaços não envia", () => {
    expect(oQueOEnterFaz(tecla("Enter"), onde(""))).toBe("ignorar");
    expect(oQueOEnterFaz(tecla("Enter"), onde("   \n "))).toBe("ignorar");
    expect(oQueOEnterFaz(tecla("Enter", { ctrlKey: true }), onde(""))).toBe("ignorar");
  });

  it("com a lista do / aberta o Enter escolhe e NUNCA envia, com ou sem Ctrl, Shift ou toque", () => {
    for (const extra of [{}, { ctrlKey: true }, { shiftKey: true }, { metaKey: true }]) {
      for (const toque of [false, true]) {
        expect(oQueOEnterFaz(tecla("Enter", extra), onde("/pix", { listaDaBarraAberta: true, toque }))).toBe(
          "escolher_resposta",
        );
      }
    }
  });

  it('texto que começa com "/" pede confirmação em vez de enviar (o "/pix" literal do laboratório)', () => {
    expect(oQueOEnterFaz(tecla("Enter"), onde("/pix"))).toBe("confirmar_barra");
    expect(oQueOEnterFaz(tecla("Enter", { ctrlKey: true }), onde("/pix"))).toBe("confirmar_barra");
    expect(oQueOEnterFaz(tecla("Enter"), onde("  /pix"))).toBe("confirmar_barra");
    // Barra no meio do texto é texto comum.
    expect(oQueOEnterFaz(tecla("Enter"), onde("pague em 3/4 vezes"))).toBe("enviar");
  });

  it('na nota interna o "/" não pede confirmação: a nota nunca vai ao cliente', () => {
    expect(oQueOEnterFaz(tecla("Enter"), onde("/pix", { nota: true }))).toBe("enviar");
    expect(precisaConfirmarBarra("/pix", true)).toBe(false);
    expect(precisaConfirmarBarra("/pix")).toBe(true);
    expect(precisaConfirmarBarra("oi /pix")).toBe(false);
  });
});

describe('a lista do "/" pelo teclado', () => {
  it("setas andam, Enter e Tab escolhem, Esc fecha", () => {
    expect(oQueATeclaFazNaLista(tecla("ArrowDown"))).toBe("descer");
    expect(oQueATeclaFazNaLista(tecla("ArrowUp"))).toBe("subir");
    expect(oQueATeclaFazNaLista(tecla("Enter"))).toBe("escolher");
    expect(oQueATeclaFazNaLista(tecla("Enter", { ctrlKey: true }))).toBe("escolher");
    expect(oQueATeclaFazNaLista(tecla("Tab"))).toBe("escolher");
    expect(oQueATeclaFazNaLista(tecla("Escape"))).toBe("fechar");
  });

  it("Shift+Tab sai do campo, letra comum digita, e a composição de acento não é interrompida", () => {
    expect(oQueATeclaFazNaLista(tecla("Tab", { shiftKey: true }))).toBeNull();
    expect(oQueATeclaFazNaLista(tecla("p"))).toBeNull();
    expect(oQueATeclaFazNaLista(tecla("Enter", { isComposing: true }))).toBeNull();
    expect(oQueATeclaFazNaLista(tecla("ArrowDown", { keyCode: 229 }))).toBeNull();
  });

  it("andar na lista é em círculo e nunca sai dos limites", () => {
    expect(andarNaLista(0, 3, 1)).toBe(1);
    expect(andarNaLista(2, 3, 1)).toBe(0);
    expect(andarNaLista(0, 3, -1)).toBe(2);
    expect(andarNaLista(5, 3, 1)).toBe(0);
    expect(andarNaLista(0, 0, 1)).toBe(0);
  });
});

describe("a letra digitada fora de qualquer campo vai para a caixa", () => {
  const elemento = (tag: string, extra: Record<string, unknown> = {}) =>
    ({ tagName: tag, isContentEditable: false, getAttribute: () => null, ...extra }) as unknown as EventTarget;
  const corpo = elemento("BODY");

  it("letra comum vai; foco em campo de texto não rouba a letra", () => {
    expect(letraVaiParaACaixa(tecla("a"), corpo, false)).toBe(true);
    expect(letraVaiParaACaixa(tecla("A", { shiftKey: true }), corpo, false)).toBe(true);
    expect(letraVaiParaACaixa(tecla("a"), elemento("INPUT"), false)).toBe(false);
    expect(letraVaiParaACaixa(tecla("a"), elemento("TEXTAREA"), false)).toBe(false);
    expect(letraVaiParaACaixa(tecla("a"), elemento("DIV", { isContentEditable: true }), false)).toBe(false);
  });

  it("Ctrl+K e Ctrl+B ficam como estão; Ctrl+Alt (AltGr do ABNT2) escreve", () => {
    expect(letraVaiParaACaixa(tecla("k", { ctrlKey: true }), corpo, false)).toBe(false);
    expect(letraVaiParaACaixa(tecla("b", { ctrlKey: true }), corpo, false)).toBe(false);
    expect(letraVaiParaACaixa(tecla("k", { metaKey: true }), corpo, false)).toBe(false);
    expect(letraVaiParaACaixa(tecla("/", { ctrlKey: true, altKey: true }), corpo, false)).toBe(true);
  });

  it("com diálogo, menu ou lista por cima, nada vai para a caixa", () => {
    expect(letraVaiParaACaixa(tecla("a"), corpo, true)).toBe(false);
  });

  it("tecla que não é caractere não vai, e espaço num botão aperta o botão", () => {
    expect(letraVaiParaACaixa(tecla("Enter"), corpo, false)).toBe(false);
    expect(letraVaiParaACaixa(tecla("ArrowDown"), corpo, false)).toBe(false);
    expect(letraVaiParaACaixa(tecla("Escape"), corpo, false)).toBe(false);
    expect(letraVaiParaACaixa(tecla(" "), elemento("BUTTON"), false)).toBe(false);
    expect(letraVaiParaACaixa(tecla(" "), elemento("A"), false)).toBe(false);
    expect(letraVaiParaACaixa(tecla(" "), corpo, false)).toBe(true);
  });

  it("espaço em summary, vídeo, áudio e papéis interativos fica com eles (revisão da onda 1)", () => {
    for (const tag of ["SUMMARY", "VIDEO", "AUDIO", "SELECT", "INPUT"]) {
      expect(letraVaiParaACaixa(tecla(" "), elemento(tag), false)).toBe(false);
    }
    for (const papel of ["slider", "switch", "checkbox", "tab", "menuitem", "option"]) {
      const comPapel = { tagName: "DIV", isContentEditable: false, getAttribute: (n: string) => (n === "role" ? papel : null) };
      expect(letraVaiParaACaixa(tecla(" "), comPapel as unknown as EventTarget, false)).toBe(false);
    }
    const focavel = { tagName: "DIV", isContentEditable: false, getAttribute: (n: string) => (n === "tabindex" ? "0" : null) };
    expect(letraVaiParaACaixa(tecla(" "), focavel as unknown as EventTarget, false)).toBe(false);
    // Letra comum ainda vai, mesmo com foco num botão? Não: só o espaço é poupado; a letra vai para a caixa.
    expect(letraVaiParaACaixa(tecla("a"), elemento("SUMMARY"), false)).toBe(true);
  });

  it("composição de acento não é interrompida", () => {
    expect(letraVaiParaACaixa(tecla("a", { isComposing: true }), corpo, false)).toBe(false);
    expect(letraVaiParaACaixa(tecla("a", { keyCode: 229 }), corpo, false)).toBe(false);
  });

  it("haCamadaPorCima olha diálogo, alerta, menu e lista", () => {
    const comRole = (r: string) => ({
      querySelector: (seletor: string) => (seletor.includes(`role='${r}'`) ? {} : null),
    });
    for (const r of ["dialog", "alertdialog", "menu", "listbox"])
      expect(haCamadaPorCima(comRole(r) as unknown as Document), r).toBe(true);
    expect(haCamadaPorCima({ querySelector: () => null })).toBe(false);
    expect(haCamadaPorCima(null)).toBe(false);
  });
});

describe("a caixa cresce de uma linha até seis", () => {
  it("fica entre 44 px e seis linhas, e depois rola por dentro", () => {
    expect(LINHAS_DA_CAIXA).toBe(6);
    expect(alturaDaCaixa(10)).toBe(ALTURA_MINIMA_DA_CAIXA_PX);
    expect(alturaDaCaixa(44)).toBe(44);
    expect(alturaDaCaixa(100)).toBe(100);
    expect(alturaDaCaixa(164)).toBe(164);
    expect(alturaDaCaixa(900)).toBe(164);
    expect(alturaDaCaixa(Number.NaN)).toBe(44);
  });
});

describe("nenhuma letra solta faz ação (saíram R, T, E e N)", () => {
  it("a lista de atalhos não anuncia tecla solta, travessão nem seta", () => {
    for (const a of ATALHOS_DO_TECLADO) {
      expect(a.teclas + a.faz).not.toMatch(/[—–→←⇒]/);
      expect(a.teclas, a.teclas).not.toMatch(/^[A-Za-z]$/);
    }
  });
});
