import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { telefoneParaZapi } from "@/domain/whatsapp/zapi-envio";
import { linkDoWhatsapp } from "@/domain/pagamento/pix";

const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

/**
 * Simulação ao vivo de 26/10/2026 (orçamento #133, cliente AGENCIA BEX): o botão "WhatsApp" abriu o
 * compartilhamento SEM destinatário — as views orcamentos_* só trazem o telefone digitado no orçamento
 * (`contato_telefone`), não o do cadastro do cliente — e o orçamento seguiu em "rascunho" depois de mandado.
 */
describe("botão WhatsApp do orçamento", () => {
  it("cai no telefone do cadastro do cliente quando o orçamento não tem telefone de contato", () => {
    expect(TELA).toContain('.select("whatsapp_principal, telefone")');
    expect(TELA).toContain('String((orc as any)?.contato_telefone || foneDoCliente || "")');
  });
  it("usa o mesmo normalizador do envio do sistema", () => {
    expect(TELA).toContain("telefoneParaZapi(bruto)");
  });
  it("depois de mandar, rascunho vira enviado (congela a versão) e a lista é atualizada", () => {
    expect(TELA).toContain('if ((orc as any)?.status === "rascunho") await setStatus("enviado", "Orçamento marcado como enviado");');
    expect(TELA).toContain('qc.invalidateQueries({ queryKey: ["orcamentos"] });');
  });
});

describe("número do WhatsApp", () => {
  it("celular antigo de 10 dígitos ganha o 9 e o 55 (o caso da AGENCIA BEX)", () => {
    expect(telefoneParaZapi("(96) 9111-6169")).toBe("5596991116169");
    expect(linkDoWhatsapp("(96) 9111-6169", "oi")).toBe("https://wa.me/5596991116169?text=oi");
  });
  it("DDD 55 não é confundido com o código do país", () => {
    expect(linkDoWhatsapp("(55) 99999-9999", "oi")).toBe("https://wa.me/5555999999999?text=oi");
  });
  it("já com 55 não duplica, e sem telefone abre a escolha do contato", () => {
    expect(linkDoWhatsapp("559691116169", "oi")).toBe("https://wa.me/5596991116169?text=oi");
    expect(linkDoWhatsapp(null, "oi")).toBe("https://wa.me/?text=oi");
  });
});
