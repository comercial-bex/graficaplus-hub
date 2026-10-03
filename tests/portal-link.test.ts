import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CABECALHO_DO_LINK,
  MENSAGEM_LINK_INVALIDO,
  ROTAS_DO_PORTAL,
  VALIDADE_MAXIMA_DIAS,
  VALIDADE_PADRAO_DIAS,
  linkDoWhatsapp,
  mensagemDoLink,
  situacaoDoLink,
  textoDoLink,
  tokenBemFormado,
  urlDoPortal,
  validadeEmDias,
  type LinkDoPortal,
} from "../src/domain/portal/link-do-portal";
import { gerarSegredo, hashDoSegredo } from "../src/domain/whatsapp/segredo-webhook";

/**
 * O link do portal do cliente, na parte que não depende de banco.
 *
 * O token é sorteado pelo BANCO (`portal_gerar_link`) e conferido pelo
 * SERVIDOR (formato) e de novo pelo banco (hash). Se os dois lados discordarem
 * do formato, todo link gerado na ficha abre "Link inválido" — e ninguém
 * descobre até o primeiro cliente reclamar. Por isso o teste reproduz aqui a
 * expressão SQL que gera o token.
 */

/** O que `portal_gerar_link` faz: translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_'). */
function tokenComoOBancoGera(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

describe("o token do link", () => {
  it("o formato que o banco sorteia é o formato que o servidor aceita", () => {
    for (let i = 0; i < 2000; i++) {
      const token = tokenComoOBancoGera(randomBytes(32));
      expect(token).toHaveLength(43);
      expect(tokenBemFormado(token), token).toBe(true);
    }
  });

  it("é o mesmo formato do segredo sorteado no navegador (crachá da TV, webhook)", () => {
    for (let i = 0; i < 200; i++) expect(tokenBemFormado(gerarSegredo())).toBe(true);
  });

  it("recusa o que não tem cara de token, antes de ir ao banco", () => {
    const bom = tokenComoOBancoGera(randomBytes(32));
    for (const ruim of [
      undefined,
      null,
      42,
      "",
      bom.slice(1),
      `${bom}a`,
      `${bom.slice(0, 42)}=`,
      `${bom.slice(0, 42)}+`,
      `${bom.slice(0, 42)}/`,
      "orc-245",
      " ".repeat(43),
    ]) {
      expect(tokenBemFormado(ruim), String(ruim)).toBe(false);
    }
  });

  it("o hash que o servidor manda é o SHA-256 em hex que o banco grava", async () => {
    // encode(sha256(convert_to(token, 'UTF8')), 'hex') — o mesmo de hash_token_aprovacao.
    const token = tokenComoOBancoGera(randomBytes(32));
    const doServidor = await hashDoSegredo(token);
    expect(doServidor).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(doServidor).toMatch(/^[0-9a-f]{64}$/); // o CHECK de portal_cliente_links.token_hash
    expect(await hashDoSegredo("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("viaja no cabeçalho x-portal-token, e as rotas são as cinco de /api/portal", () => {
    expect(CABECALHO_DO_LINK).toBe("x-portal-token");
    expect(Object.values(ROTAS_DO_PORTAL).sort()).toEqual([
      "/api/portal/arquivo",
      "/api/portal/arte",
      "/api/portal/envio",
      "/api/portal/mensagem",
      "/api/portal/painel",
    ]);
  });

  it("a frase de link que não abre é a combinada com o dono", () => {
    expect(MENSAGEM_LINK_INVALIDO).toBe("Link inválido ou vencido — peça um novo à Bex Print.");
  });
});

describe("validade", () => {
  it("mesmo padrão e mesmo teto da função do banco", () => {
    expect(VALIDADE_PADRAO_DIAS).toBe(30);
    expect(VALIDADE_MAXIMA_DIAS).toBe(90);
    expect(validadeEmDias("7")).toBe(7);
    expect(validadeEmDias(500)).toBe(90);
    expect(validadeEmDias(0)).toBe(1);
    expect(validadeEmDias(-3)).toBe(1);
    expect(validadeEmDias("")).toBe(30);
    expect(validadeEmDias("abc")).toBe(30);
    expect(validadeEmDias(12.9)).toBe(12);
  });
});

describe("mandar o link", () => {
  it("monta o endereço da página pública sem barra dobrada", () => {
    expect(urlDoPortal("https://bexprint.lovable.app/", "x".repeat(43))).toBe(
      `https://bexprint.lovable.app/publico/${"x".repeat(43)}`,
    );
  });

  it("WhatsApp: põe o 55 quando falta, e some sem celular plausível", () => {
    const msg = "Olá! link";
    expect(linkDoWhatsapp("(96) 99111-6169", msg)).toBe(
      `https://wa.me/5596991116169?text=${encodeURIComponent(msg)}`,
    );
    expect(linkDoWhatsapp("+55 96 99111-6169", msg)).toContain("https://wa.me/5596991116169?");
    expect(linkDoWhatsapp("3222-1111", msg)).toBeNull();
    expect(linkDoWhatsapp(null, msg)).toBeNull();
  });

  it("a mensagem pronta leva o nome, o endereço e até quando vale", () => {
    const m = mensagemDoLink("Max Lima", "https://x/publico/abc", "2026-11-01T15:00:00Z");
    expect(m).toContain("Olá, Max Lima!");
    expect(m).toContain("https://x/publico/abc");
    expect(m).toContain("01/11/2026");
    expect(mensagemDoLink(null, "u", "2026-11-01T15:00:00Z")).toMatch(/^Olá! /);
  });
});

describe("situação do link na ficha do cliente", () => {
  const agora = new Date("2026-10-02T12:00:00Z");
  const base: LinkDoPortal = {
    id: "1",
    criado_em: "2026-10-01T12:00:00Z",
    criado_por: "Harison",
    expira_em: "2026-10-31T12:00:00Z",
    revogado_em: null,
    ultimo_acesso_em: null,
  };

  it("ativo, vencido e cancelado", () => {
    expect(situacaoDoLink(base, agora)).toBe("ativo");
    expect(situacaoDoLink({ ...base, expira_em: "2026-10-02T11:59:59Z" }, agora)).toBe("vencido");
    expect(situacaoDoLink({ ...base, revogado_em: "2026-10-02T10:00:00Z" }, agora)).toBe(
      "revogado",
    );
    // cancelado ganha de vencido: a pessoa cancelou, não esqueceu
    expect(
      situacaoDoLink(
        { ...base, expira_em: "2026-10-01T13:00:00Z", revogado_em: "2026-10-01T12:30:00Z" },
        agora,
      ),
    ).toBe("revogado");
  });

  it("data ilegível não abre porta: vira vencido", () => {
    expect(situacaoDoLink({ ...base, expira_em: "amanhã" }, agora)).toBe("vencido");
  });

  it("o texto diz se o cliente já abriu", () => {
    expect(textoDoLink(base, agora)).toBe("Vale até 31/10/2026 · o cliente ainda não abriu");
    expect(textoDoLink({ ...base, ultimo_acesso_em: "2026-10-02T09:00:00Z" }, agora)).toContain(
      "último acesso do cliente em 02/10/2026",
    );
    expect(textoDoLink({ ...base, revogado_em: "2026-10-02T10:00:00Z" }, agora)).toBe(
      "Cancelado em 02/10/2026",
    );
  });
});
