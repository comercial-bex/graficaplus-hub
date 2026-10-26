import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const servidor = readFileSync("src/lib/api/orcamento-whatsapp.functions.ts", "utf8");
const tela = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

describe("Enviar pelo sistema (orçamento → Z-API)", () => {
  it("confere whatsapp.reply, gera o link no banco e enfileira o PDF como documento", () => {
    expect(servidor).toContain('exigir(context.supabase, context.userId, "whatsapp.reply")');
    expect(servidor).toContain("orcamento_link_publico");
    expect(servidor).toContain("whatsapp_responder_arquivo");
    expect(servidor).toContain('p_tipo: "documento"');
  });
  it("só aceita PDF da pasta deste orçamento e copia para a pasta da conversa", () => {
    expect(servidor).toContain("orcamento/${data.orcamentoId}/");
    expect(servidor).toContain("caixa/${conversaId}/");
  });
  it("a tela gera o PDF sem baixar, aciona o despachante e marca como enviado", () => {
    expect(tela).toContain("gerarPDFOrcamentoParaEnvio");
    expect(tela).toContain("acionarEnvio()");
    expect(tela).toContain("Enviar pelo sistema");
  });
});
