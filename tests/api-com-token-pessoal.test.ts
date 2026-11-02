import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  exemploCurl,
  filtrosDaUrl,
  LIMITE_MAXIMO,
  pareceToken,
  RECURSOS,
  recursoPorChave,
  restanteNaJanela,
  tokenDoCabecalho,
} from "../src/domain/api/recursos";

/**
 * API de leitura com token pessoal (02/11/2026), Onda 1 do "API/MCP": o
 * contrato dos recursos e filtros, a leitura do token e a janela por minuto.
 * Quem decide o que a pessoa vê é o banco (`api_consultar` lê como ela).
 */

const ler = (c: string) => readFileSync(c, "utf8");

describe("recursos e filtros", () => {
  it("cinco recursos, cada um com campos e filtros declarados", () => {
    expect(RECURSOS.map((r) => r.chave)).toEqual(["clientes", "orcamentos", "os", "contas_receber", "contas_pagar"]);
    for (const r of RECURSOS) {
      expect(r.campos.length).toBeGreaterThan(5);
      expect(r.filtros).toContain("limite");
      expect(r.descricao.length).toBeGreaterThan(10);
    }
    expect(recursoPorChave("clientes")?.filtros).not.toContain("status");
    expect(recursoPorChave("contas_receber")?.filtros).not.toContain("busca");
    expect(recursoPorChave("nada")).toBeNull();
  });

  it("filtros válidos passam tipados; os inválidos dizem o porquê", () => {
    const orc = recursoPorChave("orcamentos")!;
    expect(filtrosDaUrl(new URLSearchParams("status=enviado&limite=20&deslocamento=40&desde=2026-10-01&ate=2026-10-31&busca=lona"), orc)).toEqual({
      ok: true,
      filtros: { status: "enviado", limite: 20, deslocamento: 40, desde: "2026-10-01", ate: "2026-10-31", busca: "lona" },
    });
    expect(filtrosDaUrl(new URLSearchParams(""), orc)).toEqual({ ok: true, filtros: {} });
    expect(filtrosDaUrl(new URLSearchParams("limite=0"), orc)).toMatchObject({ ok: false });
    expect(filtrosDaUrl(new URLSearchParams(`limite=${LIMITE_MAXIMO + 1}`), orc)).toMatchObject({ ok: false });
    expect(filtrosDaUrl(new URLSearchParams("limite=abc"), orc)).toMatchObject({ ok: false });
    expect(filtrosDaUrl(new URLSearchParams("desde=01/10/2026"), orc)).toMatchObject({ ok: false });
    expect(filtrosDaUrl(new URLSearchParams("desde=2026-10-31&ate=2026-10-01"), orc)).toMatchObject({ ok: false });
    expect(filtrosDaUrl(new URLSearchParams("inexistente=1"), orc)).toMatchObject({ ok: false });
    // Cliente não tem status: pedir é erro, não silêncio.
    expect(filtrosDaUrl(new URLSearchParams("status=x"), recursoPorChave("clientes")!)).toMatchObject({ ok: false });
    // Busca vazia some em vez de virar filtro de nada.
    expect(filtrosDaUrl(new URLSearchParams("busca=   "), orc)).toEqual({ ok: true, filtros: {} });
  });
});

describe("token e janela", () => {
  const TOKEN = "bxp_" + "a".repeat(48);

  it("reconhece o formato do token e lê dos dois cabeçalhos", () => {
    expect(pareceToken(TOKEN)).toBe(true);
    expect(pareceToken("bxp_curto")).toBe(false);
    expect(pareceToken("Bearer " + TOKEN)).toBe(false);
    expect(tokenDoCabecalho(new Headers({ "x-api-key": ` ${TOKEN} ` }))).toBe(TOKEN);
    expect(tokenDoCabecalho(new Headers({ authorization: `Bearer ${TOKEN}` }))).toBe(TOKEN);
    expect(tokenDoCabecalho(new Headers({ authorization: "Basic abc" }))).toBeNull();
    expect(tokenDoCabecalho(new Headers())).toBeNull();
  });

  it("a janela de um minuto deixa passar 100 e segura a 101ª; a mais velha sai depois de 60 s", () => {
    const batidas: number[] = [];
    const t0 = 1_000_000;
    for (let i = 0; i < 100; i++) expect(restanteNaJanela(batidas, t0 + i)).toBe(99 - i);
    expect(restanteNaJanela(batidas, t0 + 100)).toBe(-1);
    // 60 s depois, as duas batidas mais velhas (t0 e t0+1) saem da janela: cabe mais uma e sobra 1.
    expect(restanteNaJanela(batidas, t0 + 60_001)).toBe(1);
  });

  it("o exemplo é um curl com o cabeçalho e o recurso", () => {
    expect(exemploCurl("https://bexprint.com.br")).toBe('curl -H "x-api-key: SEU_TOKEN" "https://bexprint.com.br/api/v1/orcamentos?limite=20"');
  });
});

describe("a migração, a rota e a tela", () => {
  it("o banco guarda só o hash, lê como a pessoa e só o servidor consulta", () => {
    const m = ler("supabase/migrations/20261102143000_api_tokens_e_consulta.sql");
    expect(m.includes("hash text NOT NULL UNIQUE")).toBe(true);
    expect(m.includes("encode(digest(v_token, 'sha256'), 'hex')")).toBe(true);
    expect(m.includes("SET LOCAL ROLE authenticated;")).toBe(true);
    // Volta ao papel de entrada; e a função é INVOKER porque o Postgres não troca de papel em DEFINER.
    expect(m.includes("EXECUTE format('SET LOCAL ROLE %I', v_papel);")).toBe(true);
    expect(/api_consultar[\s\S]{0,400}SECURITY INVOKER/.test(m)).toBe(true);
    expect(m.includes("REVOKE ALL ON FUNCTION public.api_consultar(text, text, jsonb) FROM PUBLIC, anon, authenticated;")).toBe(true);
    expect(m.includes("GRANT EXECUTE ON FUNCTION public.api_consultar(text, text, jsonb) TO service_role;")).toBe(true);
    // Leitura da tabela de tokens no nível da tabela, não por coluna (tropeço do #342).
    expect(m.includes("GRANT SELECT ON public.api_tokens TO authenticated;")).toBe(true);
    expect(m.includes("FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()))")).toBe(true);
    // Os cinco recursos da tela são os cinco do banco.
    for (const r of RECURSOS) expect(m.includes(`WHEN '${r.chave}' THEN`), r.chave).toBe(true);
  });

  it("a rota repassa ao servidor e o servidor devolve erros com frase", () => {
    const rota = ler("src/routes/api.v1.$recurso.ts");
    expect(rota.includes('createFileRoute("/api/v1/$recurso")')).toBe(true);
    expect(rota.includes("consultarRecurso(request, params.recurso)")).toBe(true);
    const servidor = ler("src/lib/api/v1.server.ts");
    expect(servidor.includes('case "token_expirado":')).toBe(true);
    expect(servidor.includes("retry-after")).toBe(true);
    expect(servidor.includes('("api_consultar", {')).toBe(true);
    expect(servidor.includes("createHash(\"sha256\").update(token)")).toBe(true);
  });

  it("a tela mostra o token uma vez, lista com prefixo, revoga com confirmação e não usa title=", () => {
    const tela = ler("src/routes/_authenticated/configuracoes-api.tsx");
    expect(tela.includes("Copie agora. Este token não aparece de novo.")).toBe(true);
    expect(tela.includes("Confirmar revogação")).toBe(true);
    expect(tela.includes('("criar_api_token", { p_nome: nome.trim(), p_dias: dias })')).toBe(true);
    expect(tela.includes('("revogar_api_token", { p_id: id })')).toBe(true);
    expect(tela.includes("Trate como senha.")).toBe(true);
    expect(/\stitle=/.test(tela)).toBe(false);
    expect(/(?<![-\w])text-primary(?![-\w])/.test(tela)).toBe(false);
    const menu = ler("src/lib/menu.ts");
    expect(menu.includes('"/configuracoes-api"')).toBe(true);
  });
});
