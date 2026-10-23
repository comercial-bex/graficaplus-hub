import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 23/10/2026: a Aline se inscreveu como parceira e ficou `pendente`, sem papel,
 * sem ver nada. Regra do dono: o cadastro libera na hora; a equipe suspende.
 */
const SQL = readFileSync("supabase/migrations/20261023160000_parceiro_cadastro_libera_na_hora.sql", "utf8");
const CONVITE = readFileSync("src/routes/convite.$codigo.tsx", "utf8");

describe("o cadastro por convite", () => {
  it("cria o parceiro ativo e já com o papel que abre o painel", () => {
    expect(SQL).toContain("'ativo', v_nome");
    expect(SQL).toContain("INSERT INTO public.user_roles (user_id, role) VALUES (p_usuario_id, 'parceiro')");
  });

  it("a tela diz que o acesso já está liberado e leva à aba do parceiro no login", () => {
    expect(CONVITE).toContain("já está liberado");
    expect(CONVITE).toContain('search={{ como: "parceiro" }}');
    expect(CONVITE).not.toContain("aguardando liberação");
  });
});
