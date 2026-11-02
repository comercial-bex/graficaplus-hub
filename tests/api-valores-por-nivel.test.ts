import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMPO_DA_SOMA, EXEMPLOS, FERRAMENTAS, argumentosParaFiltros, somarCampo } from "../src/domain/api/mcp";
import { filtrosDaUrl, recursoPorChave } from "../src/domain/api/recursos";

/**
 * Valores por nível na API e no MCP (02/11/2026): orçamento e OS devolvem
 * `valor_total` só para quem vê preços (a chave some para os outros), com nome
 * do cliente e filtro por cliente, e a soma do MCP vale para os quatro recursos
 * com dinheiro. A paginação ganhou desempate por `id` (sem ele a página podia
 * repetir linha e a soma sairia errada).
 */

const ler = (c: string) => readFileSync(c, "utf8");
const UUID = "7f6b165e-edad-4b03-b4f9-15bc14397b34";

describe("o contrato dos recursos", () => {
  it("orçamento e OS têm valor_total, nome do cliente e filtro por cliente; as contas não têm cliente_id", () => {
    for (const chave of ["orcamentos", "os"]) {
      const r = recursoPorChave(chave)!;
      expect(r.campos, chave).toContain("valor_total");
      expect(r.campos, chave).toContain("cliente_nome");
      expect(r.filtros, chave).toContain("cliente_id");
      expect(r.descricao, chave).toContain("só vem para quem vê preços");
    }
    expect(recursoPorChave("orcamentos")!.campos).toContain("etapa_comercial");
    for (const chave of ["clientes", "contas_receber", "contas_pagar"]) {
      expect(recursoPorChave(chave)!.filtros, chave).not.toContain("cliente_id");
    }
  });

  it("cliente_id precisa ser uuid e só vale onde o recurso aceita", () => {
    const orc = recursoPorChave("orcamentos")!;
    expect(filtrosDaUrl(new URLSearchParams(`cliente_id=${UUID}`), orc)).toEqual({ ok: true, filtros: { cliente_id: UUID } });
    expect(filtrosDaUrl(new URLSearchParams("cliente_id=Max"), orc)).toMatchObject({ ok: false });
    expect(filtrosDaUrl(new URLSearchParams(`cliente_id=${UUID}`), recursoPorChave("contas_pagar")!)).toMatchObject({ ok: false });
    expect(Object.fromEntries(argumentosParaFiltros({ recurso: "os", cliente_id: UUID, status: "aberta" }).entries())).toEqual({ cliente_id: UUID, status: "aberta" });
  });
});

describe("somar dinheiro no MCP", () => {
  it("quatro recursos, cada um com o seu campo", () => {
    expect(CAMPO_DA_SOMA).toEqual({ contas_receber: "valor", contas_pagar: "valor", orcamentos: "valor_total", os: "valor_total" });
    const somar = FERRAMENTAS.find((f) => f.name === "bexprint_somar")!;
    const props = (somar.inputSchema as { properties: { recurso: { enum: string[] } } }).properties;
    expect(props.recurso.enum).toEqual(Object.keys(CAMPO_DA_SOMA));
    expect(Object.keys(props)).toContain("cliente_id");
  });

  it("somarCampo soma a centavos, trata texto numérico e ignora lixo e ausência", () => {
    expect(somarCampo([{ valor: 10.1 }, { valor: "20.2" }, { valor: null }, {}, { valor: "abc" }], "valor")).toBe(30.3);
    expect(somarCampo([{ valor_total: 0.1 }, { valor_total: 0.2 }], "valor_total")).toBe(0.3);
    expect(somarCampo([], "valor")).toBe(0);
  });

  it("há exemplo de soma de orçamentos enviados e de contar por cliente, só com ferramentas e recursos que existem", () => {
    const pedidos = EXEMPLOS.map((e) => e.pedido);
    expect(pedidos.some((p) => /orçamentos enviados esperando resposta/.test(p))).toBe(true);
    expect(pedidos.some((p) => /orçamentos um cliente/.test(p))).toBe(true);
    const nomes = new Set(FERRAMENTAS.map((f) => f.name));
    for (const e of EXEMPLOS) for (const passo of e.passos) expect(nomes.has(passo.ferramenta), passo.ferramenta).toBe(true);
  });

  it("o servidor recusa soma de orçamento e OS para quem não vê valores, em vez de devolver zero", () => {
    const s = ler("src/lib/api/mcp.server.ts");
    expect(s.includes('leitura.corpo.ve_valores === false')).toBe(true);
    expect(s.includes('erro: "sem_valores"')).toBe(true);
    expect(s.includes("somarCampo(itens, campo)")).toBe(true);
  });
});

describe("a migração", () => {
  const m = ler("supabase/migrations/20261102163000_api_valores_por_nivel.sql");

  it("valor_total sai da view comercial e some, como chave, para quem não vê preço", () => {
    expect(m.includes("LEFT JOIN public.orcamentos_comercial oc ON oc.id = o.id")).toBe(true);
    expect(m.includes("LEFT JOIN public.ordens_servico_comercial osc ON osc.id = s.id")).toBe(true);
    expect((m.match(/CASE WHEN v_ver THEN to_jsonb\(p\) ELSE to_jsonb\(p\) - 'valor_total' END/g) ?? []).length).toBe(2);
    expect(m.includes("v_ver := public.can_see_prices(v_tok.user_id);")).toBe(true);
    expect(m.includes("'itens', v_itens, 'usuario_id', v_tok.user_id, 've_valores', v_ver")).toBe(true);
  });

  it("toda ordenação tem desempate por id, na página e na agregação", () => {
    expect((m.match(/ORDER BY (nome|created_at DESC|data_vencimento DESC NULLS LAST|vencimento DESC NULLS LAST), id LIMIT v_limite OFFSET v_desloc/g) ?? []).length).toBe(5);
    expect((m.match(/, p\.id\) FROM pag p/g) ?? []).length).toBe(5);
  });

  it("mantém as travas: INVOKER, só service_role, troca de papel de volta e filtro por cliente", () => {
    expect(/api_consultar[\s\S]{0,400}SECURITY INVOKER/.test(m)).toBe(true);
    expect(m.includes("EXECUTE format('SET LOCAL ROLE %I', v_papel);")).toBe(true);
    expect(m.includes("REVOKE ALL ON FUNCTION public.api_consultar(text, text, jsonb) FROM PUBLIC, anon, authenticated;")).toBe(true);
    expect(m.includes("GRANT EXECUTE ON FUNCTION public.api_consultar(text, text, jsonb) TO service_role;")).toBe(true);
    expect(m.includes("v_cliente := nullif(btrim(coalesce(p_filtros->>'cliente_id', '')), '')::uuid;")).toBe(true);
    expect(m.includes("o.cliente_id = v_cliente")).toBe(true);
    expect(m.includes("s.cliente_id = v_cliente")).toBe(true);
    // Não lê auth.users (service_role não enxerga a tabela).
    expect(/FROM auth\.users|JOIN auth\.users/.test(m)).toBe(false);
  });
});
