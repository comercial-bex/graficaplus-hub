import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 24/10/2026: o "agente" de avisos no jeito do Bex Lite. O ensaio com o cadastro
 * de parceiro pegou que a fila só aceitava entidade orcamento/ordem_servico — a
 * boas-vindas teria derrubado o cadastro junto.
 */
const SQL = readFileSync("supabase/migrations/20261024200000_avisos_da_equipe_e_boas_vindas.sql", "utf8");
const USUARIOS = readFileSync("src/lib/api/usuarios.functions.ts", "utf8");

describe("avisos da equipe e boas-vindas", () => {
  it("a lista da operação ganhou prazo vencido, paradas, arte sem aceite e parceiro sem atendente", () => {
    for (const t of ["OS com o prazo vencido", "OS paradas no atendimento ou na criação", "sem o aceite do cliente registrado", "Parceiros novos sem atendente"]) {
      expect(SQL).toContain(t);
    }
  });
  it("a fila aceita as entidades novas e o gatilho não derruba o cadastro", () => {
    expect(SQL).toContain("'parceiro'::text, 'usuario'::text");
    expect(SQL).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(SQL).toContain("RAISE WARNING");
  });
  it("boas-vindas do parceiro: uma vez por parceiro, só quando ativo e com login", () => {
    expect(SQL).toContain("'parceiro:' || NEW.id::text || ':boas_vindas'");
    expect(SQL).toContain("NEW.status <> 'ativo' OR NEW.usuario_id IS NULL");
  });
  it("boas-vindas da equipe leva o link e nunca a senha", () => {
    expect(USUARIOS).toContain("usuario_boas_vindas");
    const trecho = USUARIOS.slice(USUARIOS.indexOf("usuario_boas_vindas") - 400, USUARIOS.indexOf("usuario_boas_vindas") + 600);
    expect(trecho).not.toMatch(/senha:\s*data\.senha|p_variaveis:[^}]*senha/);
  });
  it("o texto da boas-vindas da equipe avisa que a senha vem da gerência", () => {
    expect(SQL).toContain("A senha inicial foi passada pela gerência");
  });
});
