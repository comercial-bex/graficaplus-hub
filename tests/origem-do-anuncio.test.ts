import { describe, expect, it } from "vitest";
import { camposDeOrigem, canalDoSinal, limparTexto } from "@/domain/whatsapp/origem-do-anuncio";

const base = { type: "ReceivedCallback", phone: "5500000000000", text: { message: "oi" } };
const SEM = { canal: null, tipo: null, anuncioId: null, titulo: null, corpo: null, link: null, ctwaClid: null, entrada: null };

/** Anúncio como o Z-API entrega (ids reais da conta Bex Print, texto do criativo). */
function anuncioReal(over: Record<string, unknown> = {}) {
  return {
    ...base,
    text: { message: "Olá! Posso ter mais informações sobre isso?" },
    externalAdReply: {
      sourceApp: "instagram",
      sourceType: "ad",
      sourceId: "120252258241600481",
      title: "Lona e adesivo em até 4h",
      body: "Peça pronta no mesmo dia em Macapá.",
      sourceUrl: "https://fb.me/abc123",
      ctwaClid: "AfEx-clid_123",
      thumbnailUrl: "https://example.com/t.jpg",
      ...over,
    },
    adContext: { entryPointConversionApp: "instagram", entryPointConversionSource: "ctwa_ad", conversionSource: "FB_Ads" },
  };
}

describe("canalDoSinal e camposDeOrigem", () => {
  it("anúncio de verdade vira campos planos completos", () => {
    const p = anuncioReal();
    expect(canalDoSinal(p)).toEqual({
      canal: "instagram",
      tipo: "anuncio",
      anuncioId: "120252258241600481",
      titulo: "Lona e adesivo em até 4h",
      corpo: "Peça pronta no mesmo dia em Macapá.",
      link: "https://fb.me/abc123",
      ctwaClid: "AfEx-clid_123",
      entrada: "ctwa_ad",
    });
    expect(camposDeOrigem(p)).toEqual({
      canal_origem: "instagram",
      tipo_origem: "anuncio",
      anuncio_id: "120252258241600481",
      anuncio_titulo: "Lona e adesivo em até 4h",
      anuncio_corpo: "Peça pronta no mesmo dia em Macapá.",
      anuncio_link: "https://fb.me/abc123",
      ctwa_clid: "AfEx-clid_123",
      entry_point: "ctwa_ad",
    });
  });
  it("nada vem aninhado: só texto, para tests/rpc-assinaturas conferir os parâmetros", () => {
    for (const v of Object.values(camposDeOrigem(anuncioReal()))) expect(typeof v).toBe("string");
  });
  it("facebook com anúncio", () => {
    const p = { ...base, externalAdReply: { sourceApp: "Facebook", sourceType: "ad", sourceId: "120252258241960481" }, adContext: { conversionSource: "FB_Ads" } };
    expect(canalDoSinal(p)).toMatchObject({ canal: "facebook", tipo: "anuncio", anuncioId: "120252258241960481", titulo: null });
    expect(camposDeOrigem(p)).toEqual({ canal_origem: "facebook", tipo_origem: "anuncio", anuncio_id: "120252258241960481" });
  });
  it("anúncio com sourceApp nulo ainda é catalogado, sem canal", () => {
    const p = anuncioReal({ sourceApp: null });
    p.adContext = { entryPointConversionSource: "ctwa_ad" } as typeof p.adContext;
    const c = camposDeOrigem(p);
    expect(c.canal_origem).toBeUndefined();
    expect(c).toMatchObject({ tipo_origem: "anuncio", anuncio_id: "120252258241600481", anuncio_titulo: "Lona e adesivo em até 4h" });
  });
  it("anúncio de outro app ainda entra no catálogo, sem canal", () => {
    const p = { ...base, externalAdReply: { sourceApp: "tiktok", sourceType: "ad", sourceId: "120252258241600481" } };
    expect(camposDeOrigem(p)).toEqual({ tipo_origem: "anuncio", anuncio_id: "120252258241600481" });
  });
  it("botão/perfil do Instagram sem sourceType", () => {
    const p = { ...base, adContext: { entryPointConversionApp: "instagram", entryPointConversionSource: "post_cta" } };
    expect(canalDoSinal(p)).toMatchObject({ canal: "instagram", tipo: "outro", anuncioId: null, entrada: "post_cta" });
    expect(camposDeOrigem(p)).toEqual({ canal_origem: "instagram", tipo_origem: "outro", entry_point: "post_cta" });
  });
  it("link de conversa direto (app whatsapp ou vazio) não traz canal nem anúncio", () => {
    for (const app of ["whatsapp", ""]) {
      const p = { ...base, adContext: { entryPointConversionApp: app, entryPointConversionSource: "click_to_chat_link" } };
      expect(canalDoSinal(p)).toMatchObject({ canal: null, tipo: null, anuncioId: null });
      expect(camposDeOrigem(p)).toEqual({ entry_point: "click_to_chat_link" });
    }
  });
  it("evento sem bloco de anúncio não gera campo nenhum", () => {
    expect(canalDoSinal(base)).toEqual(SEM);
    expect(camposDeOrigem(base)).toEqual({});
    expect(camposDeOrigem(null)).toEqual({});
    expect(camposDeOrigem(undefined)).toEqual({});
    expect(camposDeOrigem("texto")).toEqual({});
    expect(camposDeOrigem([1, 2])).toEqual({});
  });
  it("bloco de anúncio vazio ou com campos vazios não gera campo", () => {
    expect(camposDeOrigem({ ...base, externalAdReply: {}, adContext: {} })).toEqual({});
    expect(camposDeOrigem({ ...base, externalAdReply: { sourceApp: "", sourceType: "", sourceId: "   ", title: "  ", body: "", ctwaClid: "" } })).toEqual({});
    expect(camposDeOrigem({ ...base, externalAdReply: null, adContext: "x" })).toEqual({});
  });
  it("título e corpo da raiz da mensagem nunca viram criativo", () => {
    const p = { ...base, title: "Lista de opções", body: "corpo qualquer", externalAdReply: { sourceApp: "instagram", sourceType: "ad", sourceId: "120252258241600481" } };
    const c = camposDeOrigem(p);
    expect(c.anuncio_titulo).toBeUndefined();
    expect(c.anuncio_corpo).toBeUndefined();
  });
  it("id estranho de anúncio é descartado", () => {
    for (const id of ["AD-111", "12 34", "123", "abc", "1".repeat(41), "12345678; drop table", { x: 1 }, 120252258241600481]) {
      const c = camposDeOrigem({ ...base, externalAdReply: { sourceApp: "instagram", sourceType: "ad", sourceId: id } });
      expect(c.anuncio_id).toBeUndefined();
      expect(c.canal_origem).toBe("instagram");
    }
  });
  it("id é aparado antes de validar", () => {
    const c = camposDeOrigem({ ...base, externalAdReply: { sourceApp: "instagram", sourceType: "ad", sourceId: "  120252258241600481  " } });
    expect(c.anuncio_id).toBe("120252258241600481");
  });
  it("link só aceita http e https", () => {
    for (const link of ["javascript:alert(1)", "ftp://x.com/a", "fb.me/abc", "https://", "https://a b.com"]) {
      expect(camposDeOrigem(anuncioReal({ sourceUrl: link })).anuncio_link).toBeUndefined();
    }
    expect(camposDeOrigem(anuncioReal({ sourceUrl: "http://fb.me/x" })).anuncio_link).toBe("http://fb.me/x");
  });
  it("entrada desconhecida ou suja é descartada", () => {
    const ctx = (v: unknown) => camposDeOrigem({ ...anuncioReal(), adContext: { entryPointConversionSource: v } }).entry_point;
    expect(ctx("CTWA_AD")).toBe("ctwa_ad");
    expect(ctx("ctwa ad; --")).toBeUndefined();
    expect(ctx("x".repeat(61))).toBeUndefined();
    expect(ctx(42)).toBeUndefined();
  });
  it("texto gigante é cortado nos limites, sem quebrar o resto", () => {
    const gigante = "palavra ".repeat(200_000);
    const c = camposDeOrigem(anuncioReal({ title: gigante, body: gigante, ctwaClid: gigante, sourceUrl: "https://a.com/" + "x".repeat(5000) }));
    expect(Array.from(c.anuncio_titulo ?? "").length).toBeLessThanOrEqual(200);
    expect(Array.from(c.anuncio_corpo ?? "").length).toBeLessThanOrEqual(500);
    expect(Array.from(c.ctwa_clid ?? "").length).toBeLessThanOrEqual(300);
    expect((c.anuncio_link ?? "").length).toBeLessThanOrEqual(500);
    expect(c.anuncio_id).toBe("120252258241600481");
  });
  it("corte por caractere inteiro: emoji não é partido ao meio", () => {
    const t = limparTexto("😀".repeat(300), 200)!;
    expect(Array.from(t)).toHaveLength(200);
    expect(t).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
  it("controles e quebras de linha viram espaço", () => {
    const c = camposDeOrigem(anuncioReal({ title: "Lona\n\te\u0000adesivo\r\n  4h", body: "a b" }));
    expect(c.anuncio_titulo).toBe("Lona e adesivo 4h");
    expect(c.anuncio_corpo).toBe("a b");
  });
  it("tipos errados nos campos não quebram", () => {
    const p = anuncioReal({ title: 12, body: { a: 1 }, ctwaClid: ["x"], sourceUrl: false, sourceType: 7 });
    expect(() => camposDeOrigem(p)).not.toThrow();
    const c = camposDeOrigem(p);
    expect(c.anuncio_titulo).toBeUndefined();
    expect(c.ctwa_clid).toBeUndefined();
  });
  it("valor desconhecido de app sem anúncio não gera canal", () => {
    const p = { ...base, externalAdReply: { sourceApp: "tiktok" }, adContext: { entryPointConversionApp: "messenger" } };
    expect(canalDoSinal(p)).toEqual(SEM);
  });
});
