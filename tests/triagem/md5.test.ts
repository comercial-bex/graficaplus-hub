import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { md5 } from "../../src/domain/whatsapp/triagem/md5";

describe("md5 em TypeScript puro", () => {
  const casos = [
    "",
    "a",
    "abc",
    "message digest",
    "quero um banner grande",
    "acentuação: ç ã é ü",
    "emoji 👍 e mais texto",
    "x".repeat(55),
    "x".repeat(56),
    "x".repeat(63),
    "x".repeat(64),
    "x".repeat(65),
    "x".repeat(1000),
    "linha\ncom quebra\te tabulação",
  ];
  it.each(casos)("bate com o md5 do Node: %#", (texto) => {
    expect(md5(texto)).toBe(createHash("md5").update(texto, "utf8").digest("hex"));
  });

  it("valores clássicos do RFC 1321", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("sempre 32 caracteres hexadecimais, o formato que a coluna exige", () => {
    for (const c of casos) expect(md5(c)).toMatch(/^[0-9a-f]{32}$/);
  });
});
