import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A porta da casa e a página pública de parceiros (22/10/2026). O programa tinha
 * 0 parceiros e o convite só existia a partir de um parceiro ativo: ninguém
 * entrava pela primeira vez. Ensaio com rollback: o convite da casa cadastrou o
 * Max Lima NO cadastro dele (sem duplicar) e um telefone novo como cliente novo
 * revendedor; os dois nasceram `pendente`, sem padrinho; código errado barrado.
 */

const SQL = readFileSync("supabase/migrations/20261022170000_parceiro_porta_da_casa_e_programa_publico.sql", "utf8");
const PAGINA = readFileSync("src/routes/seja-parceiro.tsx", "utf8");
const LOGIN = readFileSync("src/routes/login.tsx", "utf8");

describe("o convite da casa", () => {
  it("o código BEXPRINT vale como convite e não precisa de parceiro ativo", () => {
    expect(SQL).toContain("SELECT true, 'Bex Print'::text WHERE upper(btrim(p_codigo)) = 'BEXPRINT'");
    expect(SQL).toContain("v_casa boolean := upper(btrim(p_codigo)) = 'BEXPRINT';");
  });

  it("nasce pendente e sem papel: quem libera é a gráfica", () => {
    expect(SQL).toContain("'pendente'");
    expect(SQL).not.toMatch(/user_roles|'ativo',\s*v_nome/);
  });

  it("sem padrinho: não há bônus de indicação nem boas-vindas para a casa", () => {
    expect(SQL).toContain("CASE WHEN v_casa THEN NULL ELSE v_padrinho.id END");
  });

  it("cliente já marcado como revendedor, com o mesmo telefone e sem cadastro de parceiro, é reaproveitado — só se for um", () => {
    expect(SQL).toContain("c.revendedor");
    expect(SQL).toContain("NOT EXISTS (SELECT 1 FROM public.parceiros pa WHERE pa.cliente_id = c.id)");
    expect(SQL).toContain("IF coalesce(array_length(v_achados, 1), 0) = 1 THEN v_cliente_id := v_achados[1]; END IF;");
  });

  it("as proteções de antes continuam: conta recém-criada, uma conta por parceiro", () => {
    expect(SQL).toContain("interval '15 minutes'");
    expect(SQL).toContain("Esta conta já é de um parceiro");
  });

  it("o convite comum segue exigindo parceiro ativo", () => {
    expect(SQL).toContain("p.status = 'ativo'");
    expect(SQL).toContain("Convite inválido ou expirado");
  });
});

describe("o programa na página pública", () => {
  it("a função devolve só o programa — nenhum dado de parceiro, cliente ou preço de produto", () => {
    const f = SQL.slice(SQL.indexOf("programa_parceiros_publico() \n") > 0 ? 0 : SQL.indexOf("CREATE OR REPLACE FUNCTION public.programa_parceiros_publico"));
    expect(f).toContain("parceiro_niveis");
    expect(f).toContain("parceiro_programa");
    expect(f).not.toMatch(/public\.parceiros\b|public\.clientes|public\.produtos/);
  });

  it("aberta ao visitante de propósito (anon), e a página não promete o que o banco não faz", () => {
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.programa_parceiros_publico() TO anon, authenticated;");
    // A boas-vindas só é prometida a quem entra INDICADO (o banco exige indicado_por).
    expect(PAGINA).toContain("Quem entra indicado ganha");
  });
});

describe("a página /seja-parceiro", () => {
  it("lê os níveis e as regras do cadastro, sem número fixo no texto", () => {
    expect(PAGINA).toContain('rpc as any)("programa_parceiros_publico")');
    expect(PAGINA).not.toMatch(/\b(15|20|25|30)%/);
  });

  it("leva ao cadastro pelo convite da casa e ao login do parceiro", () => {
    expect(PAGINA).toContain('params={{ codigo: "BEXPRINT" }}');
    expect(PAGINA).toContain('search={{ como: "parceiro" }}');
  });

  it("diz que o cadastro não dá acesso na hora", () => {
    expect(PAGINA).toContain("O cadastro não dá acesso na hora");
  });
});

describe("o login separa equipe de parceiro/terceirizado", () => {
  it("a aba vem da URL (?como=parceiro) e o padrão é a equipe", () => {
    expect(LOGIN).toContain('como: busca.como === "parceiro" ? "parceiro" : undefined,');
    expect(LOGIN).toContain('busca.como === "parceiro" ? "parceiro" : "equipe"');
  });

  it("parceiro cai no painel dele; equipe, no início; destino de link continua valendo", () => {
    const i = LOGIN.indexOf("if (destino) router.history.push(destino);");
    const bloco = LOGIN.slice(i, i + 200);
    expect(bloco).toContain('else if (como === "parceiro") navigate({ to: "/parceiro" });');
    expect(bloco).toContain('else navigate({ to: "/dashboard" });');
  });

  it("o link de cadastro muda com a aba: parceiro conhece a parceria, equipe pede registro", () => {
    expect(LOGIN).toContain('to={como === "parceiro" ? "/seja-parceiro" : "/signup"}');
  });

  it("a conta e a senha são as mesmas: o login não consulta papel nenhum (o guarda de /parceiro e de /_authenticated decide)", () => {
    expect(LOGIN).not.toContain("user_roles");
    expect(LOGIN.match(/signInWithPassword/g)).toHaveLength(1);
  });
});
