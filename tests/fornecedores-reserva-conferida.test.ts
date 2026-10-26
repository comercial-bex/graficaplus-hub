import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { situacaoDoDocumento, ROTULO_DA_SITUACAO, type CompraNoFornecedor } from "../src/domain/fornecedores/compras";
import { GUIA_PENDENCIAS } from "../src/lib/pendenciasGuia";

/**
 * RESERVA PAGA SEM NOTA: CONFERIR A RETIRADA E AVISAR O FINANCEIRO (26/10/2026).
 *
 * Na Camaleão, três compras (R$ 3.156,17) ficaram como reserva: pagas e sem
 * nota. O aviso só aparecia dentro da aba Fornecedores e não tinha como zerar.
 * Agora quem registra compra confirma a retirada, e o painel do financeiro
 * mostra as que faltam conferir. A decisão de trocar o custo dos materiais pelo
 * que se paga fica em "Decisões do dono", com o impacto nos 19 produtos.
 */

const RAIZ = join(__dirname, "..");
const SQL = readFileSync(join(RAIZ, "supabase/migrations/20261027900000_reserva_conferida_e_decisao_de_custo.sql"), "utf8").replace(
  /--[^\n]*/g,
  "",
);
const TELA = readFileSync(join(RAIZ, "src/components/fornecedores/compras-do-fornecedor.tsx"), "utf8");
const RESUMO = readFileSync(join(RAIZ, "src/domain/painel/resumo-do-dia.ts"), "utf8");

const reserva = (campos: Partial<CompraNoFornecedor> = {}): CompraNoFornecedor => ({
  id: "r1",
  fornecedor_id: "camaleao",
  documento: "RESERVA 22426",
  tipo: "reserva",
  data_operacao: "2026-08-15T16:15:21Z",
  comprador_nome: "AGENCIA BEX LTDA",
  comprador_cnpj: null,
  codigo_cliente: "1000086",
  forma_pagamento: "Dinheiro",
  condicao_pagamento: "À vista",
  pago: true,
  total_bruto: 3542.88,
  desconto: 808.58,
  total: 2734.3,
  devolve_compra_id: null,
  observacoes: null,
  fonte: null,
  itens: [],
  ...campos,
});

describe("a reserva conferida sai do aviso, sem virar venda", () => {
  it("paga e não conferida: reserva paga sem nota", () => {
    expect(situacaoDoDocumento(reserva(), [])).toBe("reserva_paga");
  });

  it("paga e conferida: retirada conferida, a nota ainda falta", () => {
    const r = reserva({ retirada_conferida_em: "2026-10-26T20:00:00Z" });
    expect(situacaoDoDocumento(r, [r])).toBe("reserva_conferida");
    expect(ROTULO_DA_SITUACAO.reserva_conferida).toContain("sem nota");
  });

  it("não paga continua em aberto, conferida ou não", () => {
    expect(situacaoDoDocumento(reserva({ pago: false, retirada_conferida_em: "2026-10-26T20:00:00Z" }), [])).toBe(
      "reserva_em_aberto",
    );
  });

  it("o aviso da aba conta só as reservas pagas não conferidas, e o botão só aparece nelas", () => {
    expect(TELA).toContain('situacaoDoDocumento(d, documentos) === "reserva_paga"');
    expect(TELA).toContain('onConferir && situacao === "reserva_paga"');
    expect(TELA).toContain('rpc("conferir_retirada_compra"');
  });
});

describe("o banco: quem confere e o aviso no painel", () => {
  it("conferir: pagamentos.create ou compras.create, só reserva paga, uma vez", () => {
    expect(SQL).toMatch(/FUNCTION public\.conferir_retirada_compra\(p_id uuid, p_obs text DEFAULT NULL\)[\s\S]*?SECURITY DEFINER/);
    expect(SQL).toContain("public.has_permission(v_uid, 'pagamentos.create') OR public.has_permission(v_uid, 'compras.create')");
    expect(SQL).toContain("IF v_doc.tipo <> 'reserva' THEN");
    expect(SQL).toContain("IF NOT v_doc.pago THEN");
    expect(SQL).toContain("IF v_doc.retirada_conferida_em IS NOT NULL THEN");
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.conferir_retirada_compra\(uuid, text\) FROM PUBLIC, anon, authenticated;/);
  });

  it("o painel do financeiro ganha a pendência, lida da função viva e só uma vez", () => {
    expect(SQL).toContain("pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure)");
    expect(SQL).toContain("IF position('compra_reserva_sem_conferir' IN d) > 0 THEN RETURN; END IF;");
    expect(SQL).toMatch(/''compra_reserva_sem_conferir''[\s\S]{0,400}''financeiro''/);
    expect(SQL).toContain("WHERE tipo = ''reserva'' AND pago AND retirada_conferida_em IS NULL");
    expect(SQL).toContain("''/fornecedores''");
  });

  it("a pendência tem guia na tela e entra nos números do dia do financeiro", () => {
    expect(GUIA_PENDENCIAS.compra_reserva_sem_conferir?.passos.length).toBeGreaterThanOrEqual(2);
    const financeiro = RESUMO.slice(RESUMO.indexOf("financeiro: ["));
    expect(financeiro).toContain('chave: "compra_reserva_sem_conferir"');
  });

  it("a decisão do custo fica com o dono, com o impacto, e nada de custo ou estoque muda aqui", () => {
    expect(SQL).toContain("'custo_dos_materiais_pelo_que_se_paga'");
    expect(SQL).toContain("19 produtos");
    expect(SQL).toMatch(/INSERT INTO public\.decisoes_pendentes[\s\S]*?ON CONFLICT \(chave\) DO NOTHING;/);
    for (const tabela of ["materiais", "material_lotes", "movimentacoes_estoque", "material_custos", "caixa_movimentos", "contas_pagar", "produtos"]) {
      expect(SQL, tabela).not.toMatch(new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+public\\.${tabela}\\b`, "i"));
    }
  });

  it("o endereço achado vai para a observação, marcado como sem confirmação, e só uma vez", () => {
    expect(SQL).toContain("Endereço achado só no TeleListas, sem confirmação");
    expect(SQL).toContain("position('TeleListas' IN observacoes) = 0");
    expect(SQL).not.toMatch(/SET\s+endereco\s*=/i);
  });
});
