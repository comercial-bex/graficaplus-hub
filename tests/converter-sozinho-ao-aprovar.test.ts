import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261026800000_converter_sozinho_ao_aprovar.sql", "utf8");
const api = readFileSync("src/lib/api/orcamento-publico.functions.ts", "utf8");

describe("Converter sozinho ao aprovar pelo link", () => {
  it("a função do banco só abre para o servidor e nunca lança", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.converter_aprovado_pelo_cliente(uuid) FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.converter_aprovado_pelo_cliente(uuid) TO service_role");
    expect(sql).toContain("EXCEPTION WHEN OTHERS THEN");
  });
  it("só converte pedido completo e tem chave de desligar", () => {
    expect(sql).toContain("pedido incompleto");
    expect(sql).toContain("converter_sozinho_ao_aprovar");
  });
  it("o servidor chama depois de gravar a aprovação, só quando aprovou", () => {
    const i = api.indexOf("converter_aprovado_pelo_cliente");
    expect(i).toBeGreaterThan(api.indexOf('.update(patch as never)'));
    expect(api).toContain('patch.status === "aprovado"');
  });
});
