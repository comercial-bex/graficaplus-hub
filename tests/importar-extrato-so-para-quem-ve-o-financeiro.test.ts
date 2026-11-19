import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

// 19/11/2026: as vendedoras têm pagamentos.confirm (confirmar Pix de OS) e importavam extrato pela função.
const RAIZ = join(__dirname, "..");
const ler = (c: string) => readFileSync(join(RAIZ, c), "utf8");
const NOVA = ler(
  "supabase/migrations/20261119110000_importar_extrato_so_para_quem_ve_o_financeiro.sql",
);
const ANTERIOR = ler("supabase/migrations/20261116230000_extrato_itau_conferido_com_o_banco.sql");
const TELA = ler("src/routes/_authenticated/contas-bancarias.tsx");
const corpo = (s: string) =>
  s.match(
    /importar_extrato\(p_conta_id uuid, p_linhas jsonb\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$/,
  )![1];
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

describe("importar extrato só para quem vê o financeiro", () => {
  it("o retrato anotado é o do corpo, e a guarda é a função de 16/11", () => {
    expect(md5(corpo(NOVA))).toBe("c8eab92181045b6da767039bf0ad9f12");
    expect(NOVA).toContain("c8eab92181045b6da767039bf0ad9f12");
    expect(md5(corpo(ANTERIOR))).toBe("6f2880eddae8a07775fa9680162f92b9");
    expect(NOVA).toContain("IS DISTINCT FROM '6f2880eddae8a07775fa9680162f92b9'");
  });

  it("só acrescenta a checagem depois da chave; o resto do corpo é igual", () => {
    const acrescimo =
      "  -- Ver o financeiro também: a vendedora tem pagamentos.confirm (confirmar Pix de OS) sem ver o caixa.\n" +
      "  IF NOT public.can_see_financials(v_uid) THEN\n" +
      "    RAISE EXCEPTION 'Importar extrato é do financeiro.' USING ERRCODE = '42501';\n" +
      "  END IF;\n";
    expect(corpo(NOVA).replace(acrescimo, "")).toBe(corpo(ANTERIOR));
    expect(corpo(NOVA).indexOf("require_permission")).toBeLessThan(
      corpo(NOVA).indexOf("can_see_financials"),
    );
  });

  it("anon sem EXECUTE e o botão da tela pede a chave E ver o financeiro", () => {
    expect(NOVA).toContain(
      "REVOKE ALL ON FUNCTION public.importar_extrato(uuid, jsonb) FROM PUBLIC, anon, authenticated;",
    );
    expect(NOVA).toContain("has_function_privilege('anon'");
    expect(TELA).toContain(
      'const podeImportar = hasPermission("pagamentos.confirm") && hasPermission("financeiro.read");',
    );
  });
});
