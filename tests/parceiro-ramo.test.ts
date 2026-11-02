import { describe, it, expect } from "vitest";
import { normalizarComprovacao } from "@/domain/parceiros/ramo";

describe("normalizarComprovacao", () => {
  it("@usuario vira link do Instagram", () => {
    expect(normalizarComprovacao("@bexprint")).toBe("https://instagram.com/bexprint");
  });
  it("instagram.com/usuario vira link completo", () => {
    expect(normalizarComprovacao("www.instagram.com/bexprint/")).toBe("https://instagram.com/bexprint");
  });
  it("site sem protocolo ganha https", () => {
    expect(normalizarComprovacao("bexprint.com.br")).toBe("https://bexprint.com.br");
  });
});
