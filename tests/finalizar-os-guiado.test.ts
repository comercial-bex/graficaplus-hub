import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { avisoDoStatus } from "../src/domain/os/movimentos";

const DIALOGO = readFileSync("src/components/os/finalizar-os-dialog.tsx", "utf8");
const TELA = readFileSync("src/routes/_authenticated/os.$id.tsx", "utf8");
const SQL = readFileSync("supabase/migrations/20261024160000_avisos_criacao_e_acabamento.sql", "utf8");

describe("finalizar a OS, guiado", () => {
  it("só 'já foi entregue' fecha a OS; retirada e entrega deixam pronto e avisam", () => {
    expect(DIALOGO).toContain('status: "aguardando_retirada"');
    expect(DIALOGO).toContain('status: "aguardando_entrega"');
    expect(DIALOGO).toContain("fechar_os");
    expect(avisoDoStatus("aguardando_retirada")).toBe("os_pronta_retirada");
    expect(avisoDoStatus("aguardando_entrega")).toBe("os_pronta_entrega");
    expect(avisoDoStatus("concluido")).toBe("os_concluida");
  });
  it("mostra as travas do banco antes e não deixa concluir com trava", () => {
    expect(DIALOGO).toContain("os_bloqueios_para");
    expect(DIALOGO).toContain('caminho === "concluir" && (travas.data?.length ?? 0) > 0');
  });
  it("o dinheiro só aparece para quem vê preço", () => {
    expect(DIALOGO).toContain("canSeePrices");
    expect(TELA).toContain("valorTotal={canSeePrices ?");
  });
  it("a tela da OS tem o botão e esconde em OS encerrada", () => {
    expect(TELA).toContain("Finalizar pedido");
    expect(TELA).toContain('["concluido", "faturado", "cancelado"].includes(os.status)');
  });
});

describe("o cliente é avisado em cada área", () => {
  it("criação e acabamento entraram na régua do banco e da tela", () => {
    expect(SQL).toContain("THEN ''os_em_criacao''");
    expect(SQL).toContain("THEN ''os_em_acabamento''");
    expect(avisoDoStatus("design")).toBe("os_em_criacao");
    expect(avisoDoStatus("em_acabamento")).toBe("os_em_acabamento");
    expect(avisoDoStatus("entrada")).toBeNull();
  });
});
