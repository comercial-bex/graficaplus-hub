import { describe, expect, it } from "vitest";
import { montarEnvio, numerosParaMencionar } from "../src/domain/whatsapp/zapi-envio";

/**
 * Menção no grupo pelo Z-API (montarEnvio em src/domain/whatsapp/zapi-envio.ts). Formato da
 * documentação pública (developer.z-api.io, "mention-participant"): send-text com phone do grupo,
 * message com "@<número>" e mentioned: ["55..."]. Dados inventados.
 */
const CRED = { instanceId: "INST", token: "TOK" };
const GRUPO = "120363000000000001-group";
const A = "5596991112233";
const B = "5596994445566";

describe("montarEnvio com mencionar", () => {
  it("grupo: corpo ganha mentioned com os números (só dígitos, 12 ou 13), sem repetir", () => {
    const r = montarEnvio(
      { tipo: "texto", para: GRUPO, texto: `Cobrança\n@${A} @${B}`, mencionar: [A, B, A, "559699111223"] },
      CRED,
    );
    expect("erro" in r).toBe(false);
    if ("erro" in r) return;
    expect(r.url).toMatch(/\/send-text$/);
    expect(r.corpo).toEqual({ phone: GRUPO, message: `Cobrança\n@${A} @${B}`, mentioned: [A, B, "559699111223"] });
  });

  it("telefone de pessoa: mencionar é ignorado, o corpo fica igual ao de hoje", () => {
    const r = montarEnvio({ tipo: "texto", para: "(96) 99111-2233", texto: "Olá", mencionar: [A, B] }, CRED);
    if ("erro" in r) throw new Error(r.erro);
    expect(r.corpo).toEqual({ phone: "5596991112233", message: "Olá" });
    expect(r.corpo).not.toHaveProperty("mentioned");
  });

  it("lista vazia ou números inválidos não viram mentioned", () => {
    for (const mencionar of [[], undefined, ["", "abc", "96991112233", "55969911122334455", "+5596991112233", " "]]) {
      const r = montarEnvio({ tipo: "texto", para: GRUPO, texto: "Cobrança", mencionar }, CRED);
      if ("erro" in r) throw new Error(r.erro);
      expect(r.corpo, JSON.stringify(mencionar)).toEqual({ phone: GRUPO, message: "Cobrança" });
    }
  });

  it("menção não entra em PDF, imagem nem botões", () => {
    const pdf = montarEnvio(
      { tipo: "pdf", para: GRUPO, documento: "https://x/a.pdf", texto: "doc", mencionar: [A] },
      CRED,
    );
    if ("erro" in pdf) throw new Error(pdf.erro);
    expect(pdf.corpo).not.toHaveProperty("mentioned");
  });

  it("numerosParaMencionar: só strings de 12 ou 13 dígitos, na ordem, sem repetir", () => {
    expect(numerosParaMencionar([B, 5596991112233, A, B, null, " 5596991112233 "])).toEqual([B, A]);
    expect(numerosParaMencionar(null)).toEqual([]);
  });
});
