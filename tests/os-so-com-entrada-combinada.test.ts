import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { conferenciaAntesDeConverter, condicaoTemEntrada } from "../src/domain/orcamentos/acordo";

const SQL = readFileSync("supabase/migrations/20261103200000_os_so_com_entrada_combinada.sql", "utf8");
const ROTA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
const CARTAO = readFileSync("src/components/orcamento/acordo-do-orcamento.tsx", "utf8");

describe("OS só nasce com entrada combinada (decisão do dono, 03/11/2026)", () => {
  it("à vista, 50% + 50% e entrada com valor passam; parcelado e acordo antigo não", () => {
    expect(condicaoTemEntrada({ forma: "Pix", modelo: "a_vista" }, 1000)).toBe(true);
    expect(condicaoTemEntrada({ forma: "Pix", modelo: "metade_metade" }, 1000)).toBe(true);
    expect(condicaoTemEntrada({ forma: "Pix", modelo: "entrada", entrada_pct: 30 }, 1000)).toBe(true);
    expect(condicaoTemEntrada({ forma: "Pix", modelo: "entrada", entrada_valor: 200 }, 1000)).toBe(true);
    expect(condicaoTemEntrada({ forma: "Pix", modelo: "entrada" }, 1000)).toBe(false);
    expect(condicaoTemEntrada({ forma: "Pix", modelo: "parcelado", parcelas: 3 }, 1000)).toBe(false);
    expect(condicaoTemEntrada({ forma: "Pix", parcelas: 3 }, 1000)).toBe(false);
  });

  it("pedido de valor zero não é barrado, como no banco", () => {
    expect(condicaoTemEntrada({ forma: "Pix", modelo: "parcelado" }, 0)).toBe(true);
  });

  it("a conferência mostra a linha só quando a tela informa a entrada", () => {
    const base = {
      temCliente: true,
      dataEntrega: "2026-11-20",
      verPreco: true,
      forma: "Pix",
      condicaoCompleta: true,
      pixRecebido: true,
      itensSemArte: 0,
      descontoPendente: false,
    };
    expect(conferenciaAntesDeConverter(base).some((i) => i.chave === "entrada")).toBe(false);
    const sem = conferenciaAntesDeConverter({ ...base, entradaCombinada: false }).find((i) => i.chave === "entrada");
    expect(sem).toMatchObject({ ok: false, nivel: "obrigatorio" });
    expect(conferenciaAntesDeConverter({ ...base, entradaCombinada: true }).find((i) => i.chave === "entrada")?.ok).toBe(true);
  });

  it("o banco recusa a conversão sem entrada, com guarda de md5 e sem mexer nas permissões", () => {
    expect(SQL).toContain("(b4b) Entrada obrigatória");
    expect(SQL).toContain("md5(v_def)");
    expect(SQL).toMatch(/WHEN 'a_vista' THEN/);
    expect(SQL).toMatch(/WHEN 'metade_metade' THEN/);
    expect(SQL).toMatch(/WHEN 'entrada' THEN/);
    expect(SQL).toContain("v_entrada_min <= 0");
    expect(SQL).not.toMatch(/GRANT|REVOKE/);
  });

  it("a tela passa a entrada para a conferência e avisa no quadro Pagamento", () => {
    expect(ROTA).toContain("entradaCombinada: condicaoTemEntrada(");
    expect(CARTAO).toContain("Sem entrada a OS não é criada");
  });
});
