import { describe, expect, it } from "vitest";
import {
  CAMINHO_WEBHOOK,
  gerarSegredo,
  hashDoSegredo,
  hashesIguais,
  urlDoWebhook,
} from "../src/domain/whatsapp/segredo-webhook";

describe("segredo do webhook", () => {
  it("sorteia valores diferentes e seguros para URL", () => {
    const a = gerarSegredo();
    const b = gerarSegredo();
    expect(a).not.toBe(b);
    // 32 bytes em base64url sem preenchimento = 43 caracteres
    expect(a).toHaveLength(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("o hash tem o formato que o banco exige", async () => {
    const h = await hashDoSegredo("qualquer");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("bate com o sha256 do Postgres — os dois lados conferem a mesma coisa", async () => {
    // Valor calculado no banco em 11/09/2026:
    //   select encode(sha256('segredo-de-teste-0911'::bytea), 'hex')
    // Se navegador e banco divergissem, a URL gerada na tela nunca passaria
    // no receptor.
    expect(await hashDoSegredo("segredo-de-teste-0911")).toBe(
      "6357cf050c973357ff3e1b855aa10c3514dbbf7fe27abd669d6053bd7c9a7602",
    );
  });
});

describe("comparação de hashes", () => {
  it("iguais e diferentes", () => {
    expect(hashesIguais("abc", "abc")).toBe(true);
    expect(hashesIguais("abc", "abd")).toBe(false);
    expect(hashesIguais("abc", "abcd")).toBe(false);
    expect(hashesIguais("", "")).toBe(true);
  });
});

describe("a URL para colar no Z-API", () => {
  it("junta origem, caminho e segredo", () => {
    expect(urlDoWebhook("https://bexprint.lovable.app", "s3gr3do")).toBe(
      `https://bexprint.lovable.app${CAMINHO_WEBHOOK}?token=s3gr3do`,
    );
  });

  it("não duplica a barra quando a origem termina com uma", () => {
    expect(urlDoWebhook("https://x.app/", "a")).toBe(`https://x.app${CAMINHO_WEBHOOK}?token=a`);
  });
});
