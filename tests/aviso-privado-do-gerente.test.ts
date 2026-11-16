import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decidirAvisoPrivado,
  ehAvisoPrivadoDoGerente,
  numerosDaGerencia,
} from "../src/domain/whatsapp/aviso-privado";
import { montarEnvio } from "../src/domain/whatsapp/zapi-envio";

const SQL = readFileSync("supabase/migrations/20261115200000_aviso_privado_do_gerente.sql", "utf8");
const DESPACHANTE = readFileSync("src/lib/api/whatsapp-enviar.server.ts", "utf8");
const EDGE = readFileSync("supabase/functions/process-automations/index.ts", "utf8");

const equipe = [
  { id: "1", nome: "Raymison Saraiva", telefone: "96984079775", papeis: ["gestor", "vendedor"] },
  { id: "2", nome: "Dono", telefone: "(96) 99111-2233", papeis: ["admin"] },
  { id: "3", nome: "Vendedora", telefone: "96991110000", papeis: ["vendedor"] },
  { id: "4", nome: "Gestor sem telefone", telefone: null, papeis: ["gestor"] },
];
const gerencia = numerosDaGerencia(equipe);
const linha = (destinatario: string, extra: object = {}) => ({
  evento: "aviso_gerente_privado",
  template: "aviso_gerente_privado",
  destinatario,
  ...extra,
});

describe("aviso privado ao gerente: quem recebe", () => {
  it("só gestor e admin com celular entram na lista, no formato com 55", () => {
    expect([...gerencia].sort()).toEqual(["5596984079775", "5596991112233"]);
  });

  it("número de gestor passa; a fila grava sem o 55 e o envio sai com ele", () => {
    const d = decidirAvisoPrivado(linha("96984079775"), gerencia);
    expect(d).toEqual({ ok: true, para: "5596984079775" });
    const m = montarEnvio({ tipo: "texto", para: d.ok ? d.para : "", texto: "oi" }, { instanceId: "I", token: "T" });
    expect(m).toEqual({
      url: "https://api.z-api.io/instances/I/token/T/send-text",
      corpo: { phone: "5596984079775", message: "oi" },
    });
  });

  it("aceita o número com 55 ou formatado", () => {
    expect(decidirAvisoPrivado(linha("5596984079775"), gerencia).ok).toBe(true);
    expect(decidirAvisoPrivado(linha("(96) 98407-9775"), gerencia).ok).toBe(true);
  });

  it("número de cliente falha", () => {
    const d = decidirAvisoPrivado(linha("96988887777"), gerencia);
    expect(d.ok).toBe(false);
  });

  it("número de parceiro falha, e vendedor também", () => {
    expect(decidirAvisoPrivado(linha("96977776666"), gerencia).ok).toBe(false);
    expect(decidirAvisoPrivado(linha("96991110000"), gerencia).ok).toBe(false);
  });

  it("grupo, vazio e lista vazia falham", () => {
    expect(decidirAvisoPrivado(linha("120363431862625987-group"), gerencia).ok).toBe(false);
    expect(decidirAvisoPrivado(linha(""), gerencia).ok).toBe(false);
    expect(decidirAvisoPrivado(linha("96984079775"), new Set()).ok).toBe(false);
  });

  it("evento e modelo precisam ser os dois deste aviso", () => {
    expect(decidirAvisoPrivado(linha("96984079775", { template: "os_pronta_retirada" }), gerencia).ok).toBe(false);
    expect(decidirAvisoPrivado(linha("96984079775", { evento: "os_pronta_retirada" }), gerencia).ok).toBe(false);
    expect(ehAvisoPrivadoDoGerente({ evento: "x", template: "aviso_gerente_privado" })).toBe(true);
    expect(ehAvisoPrivadoDoGerente({ evento: "aviso_grupo_equipe", template: "aviso_grupo_equipe" })).toBe(false);
  });
});

describe("aviso privado ao gerente: ligações", () => {
  it("o despachante confere antes do Z-API, não afrouxa a trava do grupo e não abre conversa", () => {
    expect(DESPACHANTE).toContain('"o aviso do grupo só vai para o grupo da equipe"');
    expect(DESPACHANTE).toContain("EVENTOS_SO_PARA_GRUPO = new Set([EVENTO_DA_COBRANCA, \"aviso_grupo_equipe\"])");
    expect(DESPACHANTE).not.toMatch(/EVENTOS_SO_PARA_GRUPO[^\n]*aviso_gerente_privado/);
    const trava = DESPACHANTE.indexOf("decidirAvisoPrivado(linha, gerencia)");
    expect(trava).toBeGreaterThan(0);
    expect(trava).toBeLessThan(DESPACHANTE.indexOf("para: destinoDoEnvio"));
    expect(DESPACHANTE.indexOf("para: destinoDoEnvio")).toBeLessThan(DESPACHANTE.indexOf("await chamarZapi(montado, clientToken)", trava));
    expect(DESPACHANTE).toContain("para: destinoDoEnvio");
    expect(DESPACHANTE).toMatch(/ehGrupoZapi\(request\.phone\)\s*\|\|\s*avisoPrivado/);
  });

  it("a função de borda nunca envia este aviso", () => {
    expect(EDGE).toContain('item.evento === "aviso_gerente_privado"');
    // Antes de olhar o modelo (modelo desligado marcaria "enviado" sem enviar) e sem gastar tentativa.
    expect(EDGE.indexOf('item.evento === "aviso_gerente_privado"')).toBeLessThan(EDGE.indexOf("porEvento.get(item.template)"));
    expect(EDGE).toMatch(/tentativas: Math\.max\(0, \(item\.tentativas \?\? 1\) - 1\)/);
    expect(EDGE).not.toContain("só sai pelo despachante do app\");");
  });
});

describe("migração do modelo", () => {
  it("cria o modelo {{texto}} com o mesmo padrão do grupo, ativo só se o do grupo estiver", () => {
    expect(SQL).toContain("INSERT INTO public.notificacao_templates (evento, canal, corpo, descricao, ativo)");
    expect(SQL).toContain("'aviso_gerente_privado', 'whatsapp', '{{texto}}'");
    expect(SQL).toContain("t.evento = 'aviso_grupo_equipe'");
    expect(SQL).toContain("WHERE NOT EXISTS (SELECT 1 FROM public.notificacao_templates WHERE evento = 'aviso_gerente_privado')");
  });

  it("não enfileira, não liga nada e não toca em função ou trava", () => {
    expect(SQL).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER)/i);
    expect(SQL).not.toMatch(/^\s*[^-\s].*enfileirar_notificacao\s*\(/im);
    expect(SQL).not.toMatch(/^\s*(UPDATE|DELETE|ALTER|DROP)\b/im);
  });
});
