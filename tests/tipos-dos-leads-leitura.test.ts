import { beforeEach, describe, expect, it, vi } from "vitest";

const { consultar } = vi.hoisted(() => ({ consultar: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ select: () => ({ in: consultar }) }),
} }));
import { lerTiposDosLeads } from "../src/lib/crm/tipos-dos-leads";

describe("leitura tolerante de tipos de leads", () => {
  beforeEach(() => consultar.mockReset());
  it("não consulta quando não há lead ligado", async () => {
    expect(await lerTiposDosLeads([])).toEqual(new Map());
    expect(consultar).not.toHaveBeenCalled();
  });
  it("retorna mapa vazio somente quando tipo ainda não existe", async () => {
    consultar.mockResolvedValue({ data: null, error: { code: "42703", message: "column leads.tipo does not exist" } });
    expect(await lerTiposDosLeads(["lead1"])).toEqual(new Map());
  });
  it("lê parceiro persistido e normaliza ausência para cliente", async () => {
    consultar.mockResolvedValue({ data: [{ id: "lead1", tipo: "parceiro" }, { id: "lead2" }], error: null });
    expect(await lerTiposDosLeads(["lead1", "lead2"])).toEqual(new Map([["lead1", "parceiro"], ["lead2", "cliente"]]));
  });
  it("não disfarça erros de permissão como cliente", async () => {
    const error = { code: "42501", message: "permission denied" };
    consultar.mockResolvedValue({ data: null, error });
    await expect(lerTiposDosLeads(["lead1"])).rejects.toEqual(error);
  });
  it("remove IDs repetidos e limita cada lote a 100", async () => {
    consultar.mockResolvedValue({ data: [], error: null });
    const ids = Array.from({ length: 101 }, (_, i) => `lead${i}`);
    await lerTiposDosLeads([...ids, "lead0"]);
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(consultar).toHaveBeenNthCalledWith(1, "id", ids.slice(0, 100));
    expect(consultar).toHaveBeenNthCalledWith(2, "id", ["lead100"]);
  });
});