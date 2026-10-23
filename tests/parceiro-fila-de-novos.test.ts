import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SQL = readFileSync("supabase/migrations/20261023180000_parceiros_novos_sem_atendente.sql", "utf8");
const FILA = readFileSync("src/components/parceiro/fila-de-aprovacao.tsx", "utf8");

describe("fila de parceiros novos", () => {
  it("a fila do banco inclui ativo recente sem atendente, não só pendente", () => {
    expect(SQL).toContain("p.status = 'pendente'");
    expect(SQL).toContain("p.responsavel_id IS NULL");
    expect(SQL).toContain("interval '14 days'");
  });
  it("a tela deixa assumir o parceiro ativo e só libera o pendente", () => {
    expect(FILA).toContain('p.status === "pendente"');
    expect(FILA).toContain("responsavel_id: user?.id");
  });
});
