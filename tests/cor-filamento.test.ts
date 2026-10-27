import { describe, expect, it } from "vitest";
import { amostraDaCor } from "@/lib/cor-filamento";

describe("amostraDaCor", () => {
  it("reconhece cor com acento e adjetivo", () => {
    expect(amostraDaCor("Lilás V-Silk").chave).toBe("lilas");
    expect(amostraDaCor("Amarelo translúcido").chave).toBe("amarelo");
    expect(amostraDaCor("Vermelho Marsala").chave).toBe("vermelho");
  });
  it("tricolor vira multicor", () => {
    expect(amostraDaCor("Tricolor: roxo, azul céu e amarelo").chave).toBe("multicor");
  });
  it("sem cor reconhecida fica neutra", () => {
    expect(amostraDaCor("Blue 1x").chave).toBe("azul");
    expect(amostraDaCor(null).chave).toBe("outra");
  });
});
