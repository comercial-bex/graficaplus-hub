import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAPEIS_QUE_VEEM_TUDO } from "../src/lib/pendenciasGuia";

const SQL = readFileSync(
  "supabase/migrations/20261103100000_rolo_sem_estoque_cheio_vira_critico.sql",
  "utf8",
);

describe("rolo sem estoque cheio aparece em vermelho", () => {
  it("a migração troca atenção por crítico só nessa linha, com guarda de md5", () => {
    expect(SQL).toContain("md5(v_def)");
    expect(SQL).toContain(`$$'atencao', 'gestao'$$`);
    expect(SQL).toContain(`$$'critico', 'gestao'$$`);
    expect(SQL).not.toMatch(/'critico', 'financeiro'/);
  });

  it("gerência, administrador e financeiro enxergam o aviso", () => {
    for (const papel of ["admin", "gestor", "financeiro"]) {
      expect(PAPEIS_QUE_VEEM_TUDO as readonly string[]).toContain(papel);
    }
  });
});
