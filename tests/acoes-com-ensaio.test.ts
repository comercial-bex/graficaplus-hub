import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACOES, acaoPorChave, ehConfirmado, lerArgumentos } from "../src/domain/api/acoes";
import { FERRAMENTAS } from "../src/domain/api/mcp";

/**
 * Ações do MCP com ensaio (02/11/2026), Onda 3: três ações que já existem como
 * botão e não mexem em dinheiro; ensaio por padrão, gravação só com
 * confirmado = true, sempre como a pessoa dona do token.
 */

const ler = (c: string) => readFileSync(c, "utf8");
const UUID = "6e6693f1-ea58-42b8-acf6-46fae959566a";

describe("o catálogo de ações", () => {
  it("são três, sem dinheiro, cada uma com efeito, onde fica e argumentos", () => {
    expect(ACOES.map((a) => a.chave)).toEqual(["renovar_orcamento", "mover_etapa_comercial", "registrar_nota_do_cliente"]);
    for (const a of ACOES) {
      expect(a.efeito.length).toBeGreaterThan(20);
      expect(a.ondeFica.length).toBeGreaterThan(5);
      expect(a.argumentos.length).toBeGreaterThan(0);
      expect(/pagamento|valor|aprovar|cobrar/i.test(a.chave)).toBe(false);
    }
    const executar = FERRAMENTAS.find((f) => f.name === "bexprint_executar")!;
    const enumAcoes = (executar.inputSchema as { properties: { acao: { enum: string[] } } }).properties.acao.enum;
    expect(enumAcoes).toEqual(ACOES.map((a) => a.chave));
    expect((executar.inputSchema as { required: string[] }).required).toEqual(["acao", "argumentos"]);
  });

  it("lerArgumentos aceita o certo e explica o errado", () => {
    const renovar = acaoPorChave("renovar_orcamento")!;
    expect(lerArgumentos(renovar, { orcamento_id: UUID })).toEqual({ ok: true, argumentos: { orcamento_id: UUID } });
    expect(lerArgumentos(renovar, {})).toMatchObject({ ok: false });
    expect(lerArgumentos(renovar, { orcamento_id: "123" })).toMatchObject({ ok: false });
    expect(lerArgumentos(renovar, { orcamento_id: UUID, extra: 1 })).toMatchObject({ ok: false });

    const mover = acaoPorChave("mover_etapa_comercial")!;
    expect(lerArgumentos(mover, { orcamento_id: UUID, etapa: "aceite_verbal" })).toMatchObject({ ok: true });
    expect(lerArgumentos(mover, { orcamento_id: UUID, etapa: "ganho" })).toMatchObject({ ok: false });

    const nota = acaoPorChave("registrar_nota_do_cliente")!;
    expect(lerArgumentos(nota, { cliente_id: UUID, texto: "  Combinado entrega sexta  " })).toEqual({ ok: true, argumentos: { cliente_id: UUID, texto: "Combinado entrega sexta" } });
    expect(lerArgumentos(nota, { cliente_id: UUID, texto: "x".repeat(2001) })).toMatchObject({ ok: false });
    expect(lerArgumentos(nota, { cliente_id: UUID, texto: "   " })).toMatchObject({ ok: false });
  });

  it("confirmado só vale como true exato", () => {
    expect(ehConfirmado(true)).toBe(true);
    for (const v of ["true", 1, "sim", {}, null, undefined, false]) expect(ehConfirmado(v)).toBe(false);
  });
});

describe("o banco e o servidor", () => {
  it("api_executar roda como a pessoa, só grava com confirmado e registra o rastro", () => {
    const m = ler("supabase/migrations/20261102153000_api_executar_acoes_com_ensaio.sql");
    expect(m.includes("CREATE TABLE public.api_acoes")).toBe(true);
    expect(m.includes("SET LOCAL ROLE authenticated;")).toBe(true);
    expect(m.includes("EXECUTE format('SET LOCAL ROLE %I', v_papel);")).toBe(true);
    expect(m.includes("IF p_confirmado THEN")).toBe(true);
    expect(m.includes("WHEN insufficient_privilege THEN v_res := jsonb_build_object('erro', 'sem_permissao');")).toBe(true);
    expect(m.includes("UPDATE public.api_acoes SET resultado = v_res WHERE id = v_log;")).toBe(true);
    expect(m.includes("REVOKE ALL ON FUNCTION public.api_executar(text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;")).toBe(true);
    for (const a of ACOES) expect(m.includes(`WHEN '${a.chave}' THEN`), a.chave).toBe(true);
    // Nenhuma ação mexe em dinheiro: pagamentos e contas não aparecem na função.
    expect(/INSERT INTO public\.pagamentos|UPDATE public\.pagamentos|contas_pagar/.test(m)).toBe(false);
  });

  it("o MCP expõe as duas ferramentas e o servidor só grava com confirmado exato", () => {
    const s = ler("src/lib/api/mcp.server.ts");
    expect(s.includes('case "bexprint_acoes":')).toBe(true);
    expect(s.includes('case "bexprint_executar":')).toBe(true);
    expect(s.includes("ehConfirmado(args.confirmado)")).toBe(true);
    const a = ler("src/lib/api/acoes.server.ts");
    expect(a.includes('("api_executar", {')).toBe(true);
    expect(a.includes("p_confirmado: confirmado")).toBe(true);
    expect(a.includes("lerArgumentos(acao, argumentosBrutos)")).toBe(true);
  });
});
