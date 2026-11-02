import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * A página do convite roda no Instagram e em link direto (02/11/2026): é
 * escura da marca nos dois temas, leva o banner da campanha e manda a prévia
 * do link com o banner. O formulário tem rótulo visível em todo campo.
 */
const CONVITE = readFileSync("src/routes/convite.$codigo.tsx", "utf8");
const MARCA = readFileSync("src/lib/marca.ts", "utf8");

describe("a página do convite", () => {
  it("o banner está na pasta da marca e é a prévia do link", () => {
    const m = MARCA.match(/BANNER_DO_CONVITE = "([^"]+)"/);
    expect(m).not.toBeNull();
    expect(existsSync(`public${m![1]}`)).toBe(true);
    expect(CONVITE).toContain('property: "og:image"');
    expect(CONVITE).toContain("src={BANNER_DO_CONVITE}");
    // o banner aparece inteiro (a moça e o texto): nunca cortado
    expect(CONVITE).toContain("object-contain");
    expect(CONVITE).not.toContain("object-cover");
  });

  it("o fundo é o escuro da marca (tokens da barra lateral, iguais nos dois temas)", () => {
    expect(CONVITE).toContain("bg-sidebar text-sidebar-foreground");
    expect(CONVITE).not.toContain("BexBackground");
  });

  it("todo campo tem rótulo visível e o botão de enviar é sólido, com letra preta no ciano", () => {
    // empresa, documento, cidade, UF, WhatsApp, "qual ramo" (só com Outro), comprovação, e-mail, senha
    const campos = CONVITE.match(/<CampoDeAcesso/g) ?? [];
    expect(campos.length).toBe(9);
    expect(CONVITE).not.toContain("<input");
    // o ramo é um <select> nativo com rótulo ligado por htmlFor
    expect(CONVITE).toContain('htmlFor="convite-ramo"');
    expect(CONVITE).toContain('id="convite-ramo"');
    expect(CONVITE).not.toContain("aria-label=\"Qual");
    expect(CONVITE).toContain("bg-bex-cyan text-base font-bold text-black");
  });

  it("mantém o que a outra sessão pôs no convite: Pixel, UTM, ramo, comprovação e privacidade", () => {
    expect(CONVITE).toContain("META_PIXEL_ID");
    expect(CONVITE).toContain("cadastroParceiroConcluidoMeta()");
    expect(CONVITE).toContain("lerOrigemDaUrl(");
    expect(CONVITE).toContain("p_origem: origem");
    expect(CONVITE).toContain("p_ramo: ramo");
    expect(CONVITE).toContain("p_comprovacao: comprovacaoUrl");
    expect(CONVITE).toContain("mascaraWhatsapp(e.target.value)");
    expect(CONVITE).toContain('to="/privacidade"');
    expect(CONVITE).toContain("Seja parceiro revendedor da Bex Print");
  });
});
