import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classificarLead,
  colunaTipoAusente,
  ehLeadParceiro,
  filtrarParceiros,
  normalizarTipo,
  rotuloDoTipo,
  tipoDoLead,
} from "../src/domain/crm/tipo-do-lead";

const PALAVRAS = [
  { palavra: "quero ser parceiro", tipo: "parceiro" },
  { palavra: "ser parceiro", tipo: "parceiro" },
  { palavra: "terceirizado", tipo: "parceiro" },
  { palavra: "parceria", tipo: "parceiro" },
  { palavra: "quero comprar agora", tipo: "cliente_final" },
  { palavra: "quero fazer um orcamento", tipo: "cliente_final" },
  { palavra: "quero saber mais", tipo: "cliente_final" },
  { palavra: "gostei do outro", tipo: "cliente_final" },
] as const;

describe("duas modalidades", () => {
  it("só cliente_final e parceiro existem; o resto é nulo", () => {
    expect(normalizarTipo("parceiro")).toBe("parceiro");
    expect(normalizarTipo("cliente_final")).toBe("cliente_final");
    for (const v of ["cliente", "Parceiro", "terceirizado", "", null, undefined, 1, {}]) expect(normalizarTipo(v)).toBeNull();
  });
  it("a palavra proibida não existe nos arquivos de tipo do lead", () => {
    const proibida = ["re", "vend", "edor"].join("");
    for (const f of [
      "src/domain/crm/tipo-do-lead.ts",
      "src/domain/whatsapp/origem-do-contato.ts",
      "src/lib/crm/tipos-dos-leads.ts",
      "src/lib/api/origem-do-contato.functions.ts",
      "src/components/whatsapp/etiqueta-de-tipo-do-contato.tsx",
    ]) {
      expect(readFileSync(f, "utf8").toLowerCase(), f).not.toContain(proibida);
    }
  });
  it("rótulos para a equipe", () => {
    expect(rotuloDoTipo("parceiro")).toBe("Parceiro");
    expect(rotuloDoTipo("cliente_final")).toBe("Cliente final");
    expect(rotuloDoTipo(null)).toBe("Tipo a confirmar");
    expect(rotuloDoTipo("cliente")).toBe("Tipo a confirmar");
  });
});

describe("prioridade do tipo: manual, anúncio, palavra de parceiro, telefone, palavra de cliente final, sem sinal", () => {
  it("1. anúncio mapeado vence palavra e telefone", () => {
    const r = classificarLead({ anuncioTipo: "cliente_final", textoInicial: "quero ser parceiro", palavras: PALAVRAS, telefoneEhDeParceiro: true });
    expect(r).toEqual({ tipo: "cliente_final", origem: "anuncio" });
    expect(classificarLead({ anuncioTipo: "parceiro" })).toEqual({ tipo: "parceiro", origem: "anuncio" });
  });
  it("2. palavra da tabela vence telefone e aponta para parceiro", () => {
    const r = classificarLead({ textoInicial: "Oi, QUERO SER PARCEIRO da Bex!", palavras: PALAVRAS, telefoneEhDeParceiro: true });
    expect(r).toEqual({ tipo: "parceiro", origem: "palavra" });
  });
  it("3. telefone de parceiro cadastrado", () => {
    expect(classificarLead({ textoInicial: "bom dia", palavras: PALAVRAS, telefoneEhDeParceiro: true })).toEqual({ tipo: "parceiro", origem: "telefone" });
  });
  it("4. sem sinal: tipo nulo, nunca cliente final por inferência", () => {
    expect(classificarLead({})).toEqual({ tipo: null, origem: null });
    expect(classificarLead({ textoInicial: "Olá! Posso ter mais informações sobre isso?", palavras: PALAVRAS })).toEqual({ tipo: null, origem: null });
    expect(tipoDoLead({})).toBeNull();
  });
  it("anúncio sem tipo (sem conjunto) cai para a palavra", () => {
    expect(classificarLead({ anuncioTipo: null, textoInicial: "ser parceira", palavras: [{ palavra: "ser parceira", tipo: "parceiro" }] })).toEqual({ tipo: "parceiro", origem: "palavra" });
  });
  it("etiqueta manual vence qualquer regra automática", () => {
    const r = classificarLead({ tipoManual: "cliente_final", anuncioTipo: "parceiro", textoInicial: "quero ser parceiro", palavras: PALAVRAS, telefoneEhDeParceiro: true });
    expect(r).toEqual({ tipo: "cliente_final", origem: "manual" });
  });
  it("tipo manual inválido não conta", () => {
    expect(classificarLead({ tipoManual: "cliente", anuncioTipo: "parceiro" })).toEqual({ tipo: "parceiro", origem: "anuncio" });
  });
  it("palavra sem acento, com pontuação e com caixa diferente casa; meu parceiro indicou não", () => {
    const t = (x: string) => tipoDoLead({ textoInicial: x, palavras: PALAVRAS });
    expect(t("Quero ser parceiro, Bex Print!")).toBe("parceiro");
    expect(t("PARCERIA com vocês")).toBe("parceiro");
    expect(t("parcerias")).toBe("parceiro");
    expect(t("sou terceirizado")).toBe("parceiro");
    expect(t("meu parceiro me indicou")).toBeNull();
    expect(t("")).toBeNull();
    expect(tipoDoLead({ textoInicial: null, palavras: PALAVRAS })).toBeNull();
  });
  it("palavra de cliente final marca cliente final pela palavra", () => {
    for (const t of ["Quero comprar agora", "oi, quero fazer um orçamento!", "QUERO SABER MAIS", "gostei do outro, tem?"]) {
      expect(classificarLead({ textoInicial: t, palavras: PALAVRAS }), t).toEqual({ tipo: "cliente_final", origem: "palavra" });
    }
  });
  it("palavra de parceiro vence palavra de cliente final na mesma mensagem", () => {
    const r = classificarLead({ textoInicial: "quero saber mais, quero ser parceiro", palavras: PALAVRAS });
    expect(r).toEqual({ tipo: "parceiro", origem: "palavra" });
  });
  it("telefone de parceiro vence palavra de cliente final, mas não palavra de parceiro", () => {
    expect(classificarLead({ textoInicial: "quero comprar agora", palavras: PALAVRAS, telefoneEhDeParceiro: true })).toEqual({ tipo: "parceiro", origem: "telefone" });
  });
  it("anúncio e etiqueta manual vencem a palavra de cliente final", () => {
    expect(classificarLead({ anuncioTipo: "parceiro", textoInicial: "quero comprar agora", palavras: PALAVRAS })).toEqual({ tipo: "parceiro", origem: "anuncio" });
    expect(classificarLead({ tipoManual: "parceiro", textoInicial: "quero comprar agora", palavras: PALAVRAS })).toEqual({ tipo: "parceiro", origem: "manual" });
  });
  it("palavra de cliente final tem fronteira só à esquerda e palavra inativa nem chega aqui", () => {
    expect(tipoDoLead({ textoInicial: "oi quero saber maisa coisa", palavras: PALAVRAS })).toBe("cliente_final");
    expect(tipoDoLead({ textoInicial: "superquero comprar agora", palavras: PALAVRAS })).toBeNull();
    expect(tipoDoLead({ textoInicial: "quero comprar agora", palavras: [{ palavra: "quero ser parceiro", tipo: "parceiro" }] })).toBeNull();
  });
  it("tipo de palavra desconhecido é ignorado", () => {
    expect(tipoDoLead({ textoInicial: "quero comprar agora", palavras: [{ palavra: "quero comprar agora", tipo: "cliente" as never }] })).toBeNull();
  });
  it("sem lista de palavras (tabela vazia) a palavra não classifica nada", () => {
    expect(tipoDoLead({ textoInicial: "quero ser parceiro" })).toBeNull();
    expect(tipoDoLead({ textoInicial: "quero ser parceiro", palavras: [] })).toBeNull();
  });
  it("não há lista fixa de anúncios ou de palavras no código", () => {
    const fonte = readFileSync("src/domain/crm/tipo-do-lead.ts", "utf8");
    expect(fonte).not.toMatch(/quero ser parceir/i);
    expect(fonte).not.toMatch(/quero comprar agora/i);
    expect(fonte).not.toMatch(/\b\d{12,}\b/);
  });
});

describe("telas leem só o tipo persistido", () => {
  it("ausência não infere parceiro", () => {
    expect(ehLeadParceiro(undefined)).toBe(false);
    expect(ehLeadParceiro(null)).toBe(false);
    expect(ehLeadParceiro("cliente")).toBe(false);
    expect(ehLeadParceiro("cliente_final")).toBe(false);
    expect(ehLeadParceiro("parceiro")).toBe(true);
  });
  it("filtro mantém somente tipo parceiro persistido", () => {
    expect(filtrarParceiros([{ id: 1, tipo: "parceiro" }, { id: 2, tipo: "cliente_final" }, { id: 3 }], true)).toEqual([{ id: 1, tipo: "parceiro" }]);
  });
  it("filtro desligado mantém todos", () => {
    const leads = [{ tipo: "cliente_final" }, { tipo: "parceiro" }];
    expect(filtrarParceiros(leads, false)).toBe(leads);
  });
  it("aceita ausência SQL da coluna tipo", () => expect(colunaTipoAusente({ code: "42703", message: "column leads.tipo does not exist" })).toBe(true));
  it("aceita cache sem tipo", () => expect(colunaTipoAusente({ code: "PGRST204", message: "Could not find the 'tipo' column" })).toBe(true));
  it("não oculta falta de permissão", () => expect(colunaTipoAusente({ code: "42501", message: "permission denied for tipo" })).toBe(false));
  it("não oculta outra coluna ausente", () => expect(colunaTipoAusente({ code: "42703", message: "column nome does not exist" })).toBe(false));
});
