import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Ficha nova alcança a OS que já está aberta (21/10/2026). O material previsto
 * só nascia quando o item entrava na OS; produto que ganhava ficha depois
 * deixava a OS aberta sem previsto para sempre (achado na #165). Aplicado depois
 * de ensaio com rollback: uma linha de ficha no chaveiro, gravada como o dono
 * pela tela, deu 0,5 m² à #161 e 0,25 m² à #162; a segunda linha não duplicou a
 * primeira; 0 aviso, 0 envio.
 */

const SQL = readFileSync("supabase/migrations/20261021190000_ficha_nova_alcanca_os_aberta.sql", "utf8");
const EDITOR = readFileSync("src/components/produto-materiais-editor.tsx", "utf8");

describe("a ficha nova chega às OS abertas", () => {
  it("dispara em cada linha nova da ficha, depois de gravada", () => {
    expect(SQL).toContain("AFTER INSERT ON public.produto_materiais");
    expect(SQL).toContain("FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_nova_alcanca_os_aberta()");
  });

  it("só OS aberta: o mesmo corte da pendência; OS fechada não muda", () => {
    expect(SQL).toContain("AND os.status NOT IN ('concluido', 'faturado', 'cancelado')");
  });

  it("reaproveita a função que só insere o que falta (não duplica)", () => {
    expect(SQL).toContain("PERFORM public.gerar_materiais_previstos_os(v_os);");
  });

  it("a função do gatilho não fica exposta ao navegador", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.tg_ficha_nova_alcanca_os_aberta() FROM PUBLIC, anon, authenticated;");
  });

  it("o editor da ficha grava linha a linha (insert) — é isso que o gatilho escuta", () => {
    expect(EDITOR).toContain('supabase.from("produto_materiais" as any).insert({');
    expect(EDITOR).not.toContain(".upsert(");
  });
});
