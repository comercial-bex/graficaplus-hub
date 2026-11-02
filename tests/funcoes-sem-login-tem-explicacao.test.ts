import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/20261102400000_comentario_nas_funcoes_chamaveis_sem_login.sql", "utf8");

describe("funções chamáveis sem login dizem por quê", () => {
  it("as sete têm comentário", () => {
    for (const f of [
      "abrir_aprovacao(text)",
      "registrar_decisao_aprovacao(text, text, text)",
      "arquivo_em_aprovacao_aberta(text)",
      "convite_de_parceiro(text)",
      "parceiro_cadastrar_por_convite(text, uuid, text, text, text, text, text, text)",
      "programa_parceiros_publico()",
      "can_see_prices(uuid)",
    ]) {
      expect(SQL).toContain(`COMMENT ON FUNCTION public.${f} IS`);
    }
  });
  it("só comenta: não mexe em permissão nem em dado", () => {
    expect(SQL.replace(/--.*$/gm, "")).not.toMatch(/GRANT|REVOKE|CREATE|ALTER|INSERT|UPDATE|DELETE|DROP/i);
  });
});
