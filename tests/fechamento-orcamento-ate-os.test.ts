import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { conferenciaAntesDeConverter } from "../src/domain/orcamentos/acordo";

const base = {
  temCliente: true,
  dataEntrega: "2026-11-02",
  verPreco: true,
  forma: "PIX",
  pixRecebido: true,
  itensSemArte: 0,
  descontoPendente: false,
};

describe("conferência antes de converter", () => {
  it("tudo certo: nenhum item pendente", () => {
    expect(conferenciaAntesDeConverter(base).every((i) => i.ok)).toBe(true);
  });
  it("sem cliente, sem entrega e desconto pendente são obrigatórios", () => {
    const l = conferenciaAntesDeConverter({ ...base, temCliente: false, dataEntrega: null, descontoPendente: true });
    expect(l.filter((i) => !i.ok && i.nivel === "obrigatorio").map((i) => i.chave)).toEqual(["cliente", "entrega", "desconto"]);
  });
  it("sem layout e Pix não recebido são só avisos", () => {
    const l = conferenciaAntesDeConverter({ ...base, itensSemArte: 2, pixRecebido: false });
    expect(l.filter((i) => !i.ok).map((i) => [i.chave, i.nivel])).toEqual([
      ["pix", "aviso"],
      ["arte", "aviso"],
    ]);
  });
  it("quem não vê preço não é cobrado por pagamento, Pix e desconto", () => {
    const chaves = conferenciaAntesDeConverter({ ...base, verPreco: false, forma: null }).map((i) => i.chave);
    expect(chaves).toEqual(["cliente", "entrega", "arte"]);
  });
});

describe("visto pelo cliente e motivo da recusa", () => {
  const api = readFileSync("src/lib/api/orcamento-publico.functions.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20261027100000_orcamento_visto_e_motivo_da_conversao.sql", "utf8");
  it("abrir o link registra a visualização sem derrubar a página", () => {
    expect(api).toContain("visualizado_em");
    expect(api).toContain("não registrou a visualização");
  });
  it("a recusa da conversão automática vira evento com o motivo", () => {
    expect(sql).toContain("orcamento_conversao_automatica_recusada");
    expect(sql).toContain("GRANT SELECT (visualizado_em, visualizacoes)");
  });
});
