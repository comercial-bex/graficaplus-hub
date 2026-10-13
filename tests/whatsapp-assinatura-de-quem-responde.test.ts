import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assinarMensagem, assinaturaDaPessoa } from "../src/domain/whatsapp/assinatura";

/**
 * 13/10/2026: o Harison respondeu a Cibele pela caixa ("Oi Cibele") e no
 * celular dela chegou só o texto — sem saber quem, da gráfica, falava. Pedido
 * do dono: "qualquer colaborador que responde pelo seu perfil deve aparecer
 * para o cliente como topo da mensagem".
 */

describe("a assinatura de quem responde", () => {
  it("é o rótulo da caixa, em negrito do WhatsApp", () => {
    expect(assinaturaDaPessoa({ nome: "Harison", papeis: ["admin"] })).toBe("*Harison · Direção*");
    expect(assinaturaDaPessoa({ nome: "Cibele  Oliveira", papeis: ["financeiro"] })).toBe("*Cibele · Financeiro*");
    expect(assinaturaDaPessoa({ nome: "Leonardo Pimentel de Almeida", papeis: ["operador", "vendedor"] })).toBe(
      "*Leonardo · Comercial/Produção*",
    );
    expect(assinaturaDaPessoa({ nome: "Fulano", papeis: [] })).toBe("*Fulano*");
  });

  it("sem nome no cadastro não inventa 'Equipe': a mensagem sai sem assinatura", () => {
    expect(assinaturaDaPessoa({ nome: "  ", papeis: ["gestor"] })).toBeNull();
    expect(assinaturaDaPessoa({ nome: null, papeis: null })).toBeNull();
    expect(assinarMensagem("Oi Cibele", null)).toBe("Oi Cibele");
  });

  it("vai na primeira linha, uma vez só", () => {
    expect(assinarMensagem("Oi Cibele", "*Harison · Direção*")).toBe("*Harison · Direção*\nOi Cibele");
    // reenvio da mesma linha da fila não dobra a assinatura
    expect(assinarMensagem("*Harison · Direção*\nOi Cibele", "*Harison · Direção*")).toBe(
      "*Harison · Direção*\nOi Cibele",
    );
  });

  it("arquivo sem legenda leva só a assinatura, para o cliente saber quem mandou", () => {
    expect(assinarMensagem(undefined, "*Yvens · Gerência*")).toBe("*Yvens · Gerência*");
    expect(assinarMensagem("   ", "*Yvens · Gerência*")).toBe("*Yvens · Gerência*");
  });
});

describe("o despachante assina só o que uma pessoa escreveu", () => {
  const fonte = readFileSync("src/lib/api/whatsapp-enviar.server.ts", "utf8");

  it("a resposta da caixa (com autor e sem a chave 'ia:') é assinada antes de montar o envio", () => {
    const i = fonte.indexOf("if (linha.created_by && !daIa) {");
    const montar = fonte.indexOf("const montado = montarEnvio(pedido");
    expect(i, "o despachante não assina mais a resposta da caixa").toBeGreaterThan(0);
    expect(i).toBeLessThan(montar);
    expect(fonte.slice(i, montar)).toContain("assinarMensagem(");
  });

  it("avisos automáticos e automações não passam pela assinatura", () => {
    const avisos = fonte.slice(fonte.indexOf("async function processarAvisosAoCliente("));
    expect(avisos).not.toContain("assinarMensagem(");
  });
});
