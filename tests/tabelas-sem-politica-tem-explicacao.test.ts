import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/20261102300000_comentario_nas_tabelas_sem_politica.sql", "utf8");

describe("tabelas com RLS e sem política dizem por quê", () => {
  it("as quatro que estavam mudas ganham comentário", () => {
    for (const t of ["catalogo_links", "catalogo_link_itens", "portal_cliente_links", "whatsapp_atendimento_seq"]) {
      expect(SQL).toContain(`COMMENT ON TABLE public.${t} IS`);
    }
  });
  it("o comentário avisa que a ausência de política é de propósito", () => {
    expect((SQL.match(/nenhuma policy de propósito/g) ?? []).length).toBe(4);
  });
  it("a migração só comenta: não cria política nem mexe em dados", () => {
    expect(SQL).not.toMatch(/CREATE POLICY|ALTER TABLE|INSERT|UPDATE|DELETE|DROP/i);
  });
});
