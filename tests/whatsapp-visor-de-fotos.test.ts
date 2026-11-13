import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  contadorDeFotos,
  fotoAnterior,
  indiceDaFoto,
  proximaFoto,
  teclaDoVisor,
} from "../src/domain/whatsapp/visor";

/** O visor de fotos da conversa (onda 1, 12/11/2026): setas, fim da lista, contador, Esc. */

const CODIGO = readFileSync("src/components/whatsapp/visor-de-fotos.tsx", "utf8");

describe("andar entre as fotos", () => {
  it("a seta anda uma foto; no fim e no começo da lista fica onde está (não dá a volta)", () => {
    expect(proximaFoto(0, 5)).toBe(1);
    expect(proximaFoto(4, 5)).toBe(4);
    expect(fotoAnterior(3, 5)).toBe(2);
    expect(fotoAnterior(0, 5)).toBe(0);
  });

  it("lista vazia ou de uma foto só não quebra", () => {
    expect(proximaFoto(0, 0)).toBe(0);
    expect(proximaFoto(0, 1)).toBe(0);
    expect(fotoAnterior(0, 1)).toBe(0);
  });

  it("acha a foto da bolha na lista; fora da lista, -1", () => {
    const fotos = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(indiceDaFoto(fotos, "b")).toBe(1);
    expect(indiceDaFoto(fotos, "z")).toBe(-1);
  });
});

describe("o contador", () => {
  it('"3 de 12"; uma foto só não mostra contador', () => {
    expect(contadorDeFotos(2, 12)).toBe("3 de 12");
    expect(contadorDeFotos(0, 2)).toBe("1 de 2");
    expect(contadorDeFotos(0, 1)).toBeNull();
    expect(contadorDeFotos(0, 0)).toBeNull();
  });

  it("índice fora da lista não passa do total", () => {
    expect(contadorDeFotos(99, 4)).toBe("4 de 4");
  });
});

describe("as teclas", () => {
  it("Esc fecha", () => {
    expect(teclaDoVisor("Escape", 2, 5)).toEqual({ indice: 2, fechar: true, tratada: true });
  });

  it("as setas andam e as pontas da lista seguram", () => {
    expect(teclaDoVisor("ArrowRight", 1, 5).indice).toBe(2);
    expect(teclaDoVisor("ArrowLeft", 1, 5).indice).toBe(0);
    expect(teclaDoVisor("ArrowRight", 4, 5).indice).toBe(4);
    expect(teclaDoVisor("ArrowLeft", 0, 5).indice).toBe(0);
    expect(teclaDoVisor("Home", 3, 5).indice).toBe(0);
    expect(teclaDoVisor("End", 1, 5).indice).toBe(4);
  });

  it("outra tecla não é do visor (letra solta não faz nada)", () => {
    for (const t of ["r", "t", "e", "n", " ", "Enter", "Tab"]) {
      expect(teclaDoVisor(t, 1, 5), t).toEqual({ indice: 1, fechar: false, tratada: false });
    }
  });
});

describe("o visor desenhado, pelo código", () => {
  it("usa o Dialog do Radix (Esc, foco preso) e deixa o Esc para ele", () => {
    expect(CODIGO).toContain('from "@radix-ui/react-dialog"');
    expect(CODIGO).toContain('e.key === "Escape"');
  });

  it("anda com as setas da tela, mostra o contador e tem Baixar", () => {
    expect(CODIGO).toContain("teclaDoVisor(e.key, indice, total)");
    expect(CODIGO).toContain("contadorDeFotos(indice, total)");
    expect(CODIGO).toContain("Baixar");
    expect(CODIGO).toContain('aria-label="Foto anterior"');
    expect(CODIGO).toContain('aria-label="Próxima foto"');
    expect(CODIGO).toContain('aria-label="Fechar o visor"');
  });

  it("setas, fechar e Baixar têm 44 px", () => {
    expect((CODIGO.match(/size-11/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(CODIGO).toContain("h-11");
  });

  it("o título e a descrição existem para o leitor de tela; nenhum title, travessão nem seta", () => {
    expect(CODIGO).toContain("DialogPrimitive.Title");
    expect(CODIGO).toContain("DialogPrimitive.Description");
    expect(CODIGO).not.toMatch(/\btitle=/);
    expect(CODIGO).not.toMatch(/[—–→←⇒]/);
  });
});
