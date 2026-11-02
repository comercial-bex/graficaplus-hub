import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  argumentosParaFiltros,
  comandoClaudeCode,
  conteudoDaFerramenta,
  descobrir,
  descrever,
  erroJsonRpc,
  EXEMPLOS,
  FERRAMENTAS,
  respostaJsonRpc,
  VERSAO_DO_PROTOCOLO,
} from "../src/domain/api/mcp";
import { RECURSOS } from "../src/domain/api/recursos";

/**
 * O MCP de leitura do Bex Print (02/11/2026), Onda 2 do "API/MCP": seis
 * ferramentas genéricas no padrão do Holdprint, JSON-RPC por HTTP sem sessão,
 * o mesmo token e o mesmo caminho de leitura da API.
 */

const ler = (c: string) => readFileSync(c, "utf8");

describe("as seis ferramentas", () => {
  it("têm nome com prefixo, descrição e esquema de entrada; consultar e contar aceitam só os filtros da API", () => {
    expect(FERRAMENTAS.map((f) => f.name)).toEqual([
      "bexprint_descobrir",
      "bexprint_descrever",
      "bexprint_consultar",
      "bexprint_contar",
      "bexprint_somar",
      "bexprint_exemplos",
      "bexprint_acoes",
      "bexprint_executar",
    ]);
    for (const f of FERRAMENTAS) {
      expect(f.description.length).toBeGreaterThan(20);
      expect((f.inputSchema as { type: string }).type).toBe("object");
    }
    const consultar = FERRAMENTAS.find((f) => f.name === "bexprint_consultar")!;
    const props = Object.keys((consultar.inputSchema as { properties: Record<string, unknown> }).properties);
    expect(props.sort()).toEqual(["ate", "busca", "desde", "deslocamento", "limite", "recurso", "status"].sort());
    const recursoEnum = ((consultar.inputSchema as { properties: { recurso: { enum: string[] } } }).properties.recurso.enum);
    expect(recursoEnum).toEqual(RECURSOS.map((r) => r.chave));
  });

  it("descobrir acha o recurso pelo jeito de falar e, sem termo, lista todos", () => {
    expect(descobrir("quais orçamentos estão vencendo?").map((a) => a.recurso.chave)[0]).toBe("orcamentos");
    expect(descobrir("contas a pagar de outubro").map((a) => a.recurso.chave)).toContain("contas_pagar");
    expect(descobrir("parcelas pendentes").map((a) => a.recurso.chave)[0]).toBe("contas_receber");
    expect(descobrir("telefone do cliente").map((a) => a.recurso.chave)[0]).toBe("clientes");
    expect(descobrir("ordens em produção").map((a) => a.recurso.chave)[0]).toBe("os");
    expect(descobrir("")).toHaveLength(RECURSOS.length);
    expect(descobrir("xyzzy")).toEqual([]);
  });

  it("descrever devolve campos, filtros e status; recurso errado devolve nulo", () => {
    const d = descrever("orcamentos")!;
    expect(d.campos).toEqual(RECURSOS.find((r) => r.chave === "orcamentos")!.campos);
    expect(d.status_possiveis).toEqual(["rascunho", "enviado", "aprovado", "rejeitado", "expirado", "convertido"]);
    expect(descrever("clientes")!.status_possiveis).toBeNull();
    expect(descrever("nada")).toBeNull();
  });

  it("argumentos viram os filtros da URL, ignorando vazios e campos estranhos", () => {
    const p = argumentosParaFiltros({ recurso: "os", status: "em_producao", limite: 20, deslocamento: 0, busca: "", desde: null, extra: "x" });
    expect(Object.fromEntries(p.entries())).toEqual({ status: "em_producao", limite: "20", deslocamento: "0" });
    expect(Object.fromEntries(argumentosParaFiltros(undefined).entries())).toEqual({});
  });

  it("os exemplos citam só ferramentas que existem e recursos que existem", () => {
    const nomes = new Set(FERRAMENTAS.map((f) => f.name));
    const recursos = new Set(RECURSOS.map((r) => r.chave));
    for (const e of EXEMPLOS) {
      for (const passo of e.passos) {
        expect(nomes.has(passo.ferramenta), passo.ferramenta).toBe(true);
        expect(recursos.has((passo.argumentos as { recurso: string }).recurso)).toBe(true);
      }
    }
  });

  it("JSON-RPC e conteúdo da ferramenta têm a forma que o cliente espera", () => {
    expect(respostaJsonRpc(1, { ok: true })).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(erroJsonRpc(null, -32601, "não existe")).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "não existe" } });
    const c = conteudoDaFerramenta({ total: 3 });
    expect(c.content[0]).toEqual({ type: "text", text: JSON.stringify({ total: 3 }, null, 2) });
    expect(c.structuredContent).toEqual({ total: 3 });
    expect(c.isError).toBe(false);
    expect(conteudoDaFerramenta({ erro: "x" }, true).isError).toBe(true);
    expect(VERSAO_DO_PROTOCOLO).toBe("2025-03-26");
    expect(comandoClaudeCode("https://bexprint.com.br")).toBe(
      'claude mcp add --transport http bexprint https://bexprint.com.br/api/mcp --header "Authorization: Bearer SEU_TOKEN"',
    );
  });
});

describe("o servidor, a rota e a tela", () => {
  it("initialize e tools/list respondem sem token, tools/call exige, e a leitura é a mesma da API", () => {
    const s = ler("src/lib/api/mcp.server.ts");
    expect(s.includes('case "initialize":')).toBe(true);
    expect(s.includes('case "tools/list":')).toBe(true);
    expect(s.includes('case "tools/call":')).toBe(true);
    expect(s.includes('if (!token) {')).toBe(true);
    expect(s.includes('from "@/lib/api/v1.server"')).toBe(true);
    expect(s.includes("lerRecurso(token,")).toBe(true);
    // Notificação não tem resposta; método desconhecido é -32601; corpo que não é JSON é -32700.
    expect(s.includes('req.method.startsWith("notifications/")')).toBe(true);
    expect(s.includes("-32601")).toBe(true);
    expect(s.includes("-32700")).toBe(true);
    const rota = ler("src/routes/api.mcp.ts");
    expect(rota.includes('createFileRoute("/api/mcp")')).toBe(true);
    expect(rota.includes("POST: async ({ request })")).toBe(true);
    const api = ler("src/lib/api/v1.server.ts");
    expect(api.includes("export async function lerRecurso(")).toBe(true);
    expect(api.includes("const leitura = await lerRecurso(tokenDoCabecalho(request.headers), recurso, url.searchParams);")).toBe(true);
  });

  it("a tela mostra o endereço, o comando do Claude Code e as seis ferramentas", () => {
    const tela = ler("src/routes/_authenticated/configuracoes-api.tsx");
    expect(tela.includes('data-testid="comando-mcp"')).toBe(true);
    expect(tela.includes("comandoClaudeCode(base)")).toBe(true);
    expect(tela.includes("FERRAMENTAS.map((f) => f.name).join(")).toBe(true);
    expect(/\stitle=/.test(tela)).toBe(false);
  });
});
