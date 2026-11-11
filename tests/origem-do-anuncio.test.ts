import { describe, expect, it } from "vitest";
import { camposDeOrigem, canalDoSinal } from "@/domain/whatsapp/origem-do-anuncio";

const base = { type: "ReceivedCallback", phone: "5500000000000", text: { message: "oi" } };

describe("canalDoSinal", () => {
  it("instagram com anúncio", () => {
    const p = { ...base, externalAdReply: { sourceApp: "instagram", sourceType: "ad", sourceId: "AD-111", ctwaClid: "x" }, adContext: { entryPointConversionApp: "instagram", entryPointConversionSource: "ctwa_ad" } };
    expect(canalDoSinal(p)).toEqual({ canal: "instagram", tipo: "anuncio", anuncioId: "AD-111" });
    expect(camposDeOrigem(p)).toEqual({ canal_origem: "instagram", tipo_origem: "anuncio", anuncio_id: "AD-111" });
  });
  it("facebook com anúncio", () => {
    const p = { ...base, externalAdReply: { sourceApp: "Facebook", sourceType: "ad", sourceId: "AD-222" }, adContext: { conversionSource: "FB_Ads" } };
    expect(canalDoSinal(p)).toEqual({ canal: "facebook", tipo: "anuncio", anuncioId: "AD-222" });
  });
  it("botão/perfil do Instagram sem sourceType", () => {
    const p = { ...base, adContext: { entryPointConversionApp: "instagram", entryPointConversionSource: "post_cta" } };
    expect(canalDoSinal(p)).toEqual({ canal: "instagram", tipo: "outro", anuncioId: null });
    expect(camposDeOrigem(p)).toEqual({ canal_origem: "instagram", tipo_origem: "outro" });
  });
  it("link de conversa direto (app whatsapp ou vazio) = null", () => {
    for (const app of ["whatsapp", ""]) {
      const p = { ...base, adContext: { entryPointConversionApp: app, entryPointConversionSource: "click_to_chat_link" } };
      expect(canalDoSinal(p)).toEqual({ canal: null, tipo: null, anuncioId: null });
      expect(camposDeOrigem(p)).toEqual({});
    }
  });
  it("sem nenhum sinal = null", () => {
    expect(canalDoSinal(base).canal).toBeNull();
    expect(canalDoSinal(null).canal).toBeNull();
  });
  it("valor desconhecido = null", () => {
    const p = { ...base, externalAdReply: { sourceApp: "tiktok", sourceType: "ad" }, adContext: { entryPointConversionApp: "messenger" } };
    expect(canalDoSinal(p)).toEqual({ canal: null, tipo: null, anuncioId: null });
  });
});
