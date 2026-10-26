import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agoraEmMacapa,
  documentoComTipo,
  lerValor,
  linhaVazia,
  montarPedido,
  precoPeloDesconto,
  problemasDaCompra,
  rendeSugerido,
  totaisDaCompra,
  type FormularioDaCompra,
  type LinhaDaCompra,
} from "../src/domain/fornecedores/registro";

/**
 * REGISTRAR COMPRA NOVA NA ABA FORNECEDORES (26/10/2026).
 *
 * As 8 compras da Camaleão entraram por migração; daqui para a frente a tela
 * registra o documento do fornecedor, item por item, e tira um registro errado
 * com motivo. O banco recalcula e recusa; a tela faz as mesmas contas antes,
 * para a pessoa ver o total que vai ficar. O caso de prova é a RESERVA 22426:
 * digitando só o preço de tabela e o desconto dos prints, o total tem de dar
 * os R$ 2.734,30 que a Camaleão cobrou.
 */

const MIGRACAO = readFileSync(
  join(__dirname, "..", "supabase/migrations/20261027800000_registrar_compra_no_fornecedor.sql"),
  "utf8",
).replace(/--[^\n]*/g, "");

const linha = (campos: Partial<LinhaDaCompra>): LinhaDaCompra => ({ ...linhaVazia(), ...campos });

const formulario = (campos: Partial<FormularioDaCompra> = {}): FormularioDaCompra => ({
  tipo: "reserva",
  numero: "22426",
  data: "2026-08-15T13:15",
  comprador_nome: "AGENCIA BEX LTDA",
  comprador_cnpj: "",
  codigo_cliente: "1000086",
  forma_pagamento: "Dinheiro",
  condicao_pagamento: "À vista",
  pago: true,
  devolve_compra_id: null,
  observacoes: "",
  linhas: [],
  ...campos,
});

const RESERVA_22426 = formulario({
  linhas: [
    linha({ descricao: "VINIL BRANCO BR 1.06X50M - DEX", unidade: "RL", quantidade: "5", preco_lista: "450,00", desconto_pct: "24,4444", material_id: "vinil", rende: "53" }),
    linha({ descricao: "JETBEST DX SILVER BLACK 1L", quantidade: "1", preco_lista: "289,62", desconto_pct: "19,9986", finalidade: "tinta" }),
    linha({ descricao: "JETBEST DX SILVER CYAN 1L", quantidade: "1", preco_lista: "289,62", desconto_pct: "19,9986", finalidade: "tinta" }),
    linha({ descricao: "JETBEST DX SILVER MAGENTA 1L", quantidade: "1", preco_lista: "289,62", desconto_pct: "19,9986", finalidade: "tinta" }),
    linha({ descricao: "JETBEST DX SILVER YELLOW 1L", quantidade: "1", preco_lista: "289,62", desconto_pct: "19,9986", finalidade: "tinta" }),
    linha({ descricao: "VINIL TRANSPARENTE 1,22M PREMIUM - ALLTAK", unidade: "MT", quantidade: "5", preco_lista: "26,88", desconto_pct: "20,0149" }),
  ],
});

describe("número digitado em português", () => {
  it.each([
    ["450,00", 450],
    ["1.234,56", 1234.56],
    ["0,2317", 0.2317],
    ["12.5", 12.5],
    ["1.700.000", 1700000],
    ["R$ 97,19", 97.19],
    ["", null],
    ["abc", null],
  ])("%s → %s", (texto, esperado) => {
    expect(lerValor(texto)).toBe(esperado);
  });
});

describe("as contas da compra, iguais às do banco", () => {
  it("preço pago sai da tabela com o desconto: R$ 450 com 20% → R$ 360", () => {
    expect(precoPeloDesconto(450, 20)).toBe(360);
    expect(precoPeloDesconto(289.62, 19.9986)).toBe(231.7);
    expect(precoPeloDesconto(null, 20)).toBeNull();
  });

  it("a RESERVA 22426 digitada só com tabela e desconto dá o que a Camaleão cobrou", () => {
    expect(totaisDaCompra(RESERVA_22426)).toEqual({ bruto: 3542.88, desconto: 808.58, total: 2734.3 });
  });

  it("preço pago digitado vale mais que o da tabela", () => {
    const f = formulario({ linhas: [linha({ descricao: "X", quantidade: "2", preco_lista: "450", preco_unitario: "340" })] });
    expect(totaisDaCompra(f)).toEqual({ bruto: 900, desconto: 220, total: 680 });
  });

  it("devolução: quantidade digitada positiva vira saída; bruto = total, sem desconto (como o fornecedor mostra)", () => {
    const f = formulario({
      tipo: "devolucao",
      devolve_compra_id: "venda-23192",
      linhas: [linha({ descricao: "SOPRADOR", quantidade: "1", preco_lista: "393,14", desconto_pct: "19,8759", finalidade: "ferramenta" })],
    });
    expect(totaisDaCompra(f)).toEqual({ bruto: -315, desconto: 0, total: -315 });
    const pedido = montarPedido(f, "camaleao");
    expect(pedido.itens[0].quantidade).toBe(-1);
    expect(pedido.itens[0].preco_unitario).toBe(315);
    expect(pedido.devolve_compra_id).toBe("venda-23192");
  });
});

describe("o pedido que vai para registrar_compra_fornecedor", () => {
  it("documento no padrão dos que já estão registrados", () => {
    expect(documentoComTipo("venda", "23500")).toBe("VENDA 23500");
    expect(documentoComTipo("reserva", " 22426 ")).toBe("RESERVA 22426");
    expect(documentoComTipo("devolucao", "DEVOLUÇÃO 23222")).toBe("DEVOLUÇÃO 23222");
    expect(documentoComTipo("venda", "venda 1")).toBe("VENDA 1");
  });

  it("data na hora de Macapá; rendimento só com material; reserva não aponta para venda", () => {
    const p = montarPedido({ ...RESERVA_22426, devolve_compra_id: "nao-devia" }, "camaleao");
    expect(p.documento).toBe("RESERVA 22426");
    expect(p.data_operacao).toBe("2026-08-15T13:15:00-03:00");
    expect(p.devolve_compra_id).toBeNull();
    expect(p.itens[0]).toMatchObject({ quantidade: 5, preco_lista: 450, desconto_pct: 24.4444, preco_unitario: 340, material_id: "vinil", rende_do_material: 53 });
    expect(p.itens[1]).toMatchObject({ preco_unitario: 231.7, material_id: null, rende_do_material: null });
  });

  it("o campo de data começa no agora de Macapá", () => {
    expect(agoraEmMacapa(new Date("2026-10-26T21:30:00Z"))).toBe("2026-10-26T18:30");
  });

  it("rolo de 1,06 × 50 m rende 53 m²; litro, 1.000 ml; sem como saber, nada", () => {
    expect(rendeSugerido({ unidade: "m²", largura_bobina_m: 1.06, comprimento_bobina_m: 50 })).toBe(53);
    expect(rendeSugerido({ unidade: "ml" })).toBe(1000);
    expect(rendeSugerido({ unidade: "g" })).toBeNull();
    expect(rendeSugerido({ unidade: "m²", largura_bobina_m: null, comprimento_bobina_m: 50 })).toBeNull();
  });
});

describe("o que impede salvar aparece antes", () => {
  const agora = new Date("2026-10-26T15:00:00Z");

  it("a reserva dos prints passa", () => {
    expect(problemasDaCompra(RESERVA_22426, agora)).toEqual([]);
  });

  it("formulário vazio diz tudo o que falta", () => {
    const p = problemasDaCompra(formulario({ numero: "", comprador_nome: "", data: "" }), agora);
    expect(p).toEqual([
      "Informe o número do documento do fornecedor.",
      "Informe a data da compra.",
      "Informe quem comprou (Bex Print ou Agência Bex).",
      "A compra precisa de pelo menos um item.",
    ]);
  });

  it("data no futuro, devolução sem venda, item sem preço e material sem rendimento", () => {
    const p = problemasDaCompra(
      formulario({
        tipo: "devolucao",
        data: "2026-12-01T10:00",
        linhas: [linha({ descricao: "X", quantidade: "1", material_id: "vinil" })],
      }),
      agora,
    );
    expect(p).toEqual([
      "A data da compra está no futuro.",
      "Escolha a venda que esta devolução desfaz.",
      "Item 1: informe o preço pago ou o de tabela.",
      "Item 1: diga quanto do material uma unidade rende.",
    ]);
  });
});

describe("o banco: quem registra, quem exclui e as contas que ele refaz", () => {
  it("registrar: pagamentos.create ou compras.create; excluir: pagamentos.reverse ou compras.cancel", () => {
    expect(MIGRACAO).toMatch(/FUNCTION public\.registrar_compra_fornecedor\(p jsonb\)[\s\S]*?SECURITY DEFINER/);
    expect(MIGRACAO).toContain("public.has_permission(v_uid, 'pagamentos.create') OR public.has_permission(v_uid, 'compras.create')");
    expect(MIGRACAO).toMatch(/FUNCTION public\.excluir_compra_fornecedor\(p_id uuid, p_motivo text\)[\s\S]*?SECURITY DEFINER/);
    expect(MIGRACAO).toContain("public.has_permission(v_uid, 'pagamentos.reverse') OR public.has_permission(v_uid, 'compras.cancel')");
  });

  it("a tela usa as mesmas portas do banco", () => {
    const tela = readFileSync(join(__dirname, "..", "src/routes/_authenticated/fornecedores.tsx"), "utf8");
    expect(tela).toContain('const podeRegistrar = hasPermission("pagamentos.create") || hasPermission("compras.create");');
    expect(tela).toContain('const podeExcluir = hasPermission("pagamentos.reverse") || hasPermission("compras.cancel");');
  });

  it("ninguém de fora executa: REVOKE de PUBLIC, anon e authenticated antes do GRANT", () => {
    for (const assinatura of ["registrar_compra_fornecedor\\(jsonb\\)", "excluir_compra_fornecedor\\(uuid, text\\)"]) {
      expect(MIGRACAO).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${assinatura} FROM PUBLIC, anon, authenticated;`));
      expect(MIGRACAO).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${assinatura} TO authenticated;`));
    }
  });

  it("o total é refeito no banco: quantidade × preço pago; devolução sem desconto e só de venda", () => {
    expect(MIGRACAO).toContain("v_total := v_total + round(v_qtd * v_preco, 2);");
    expect(MIGRACAO).toContain("round((e.value ->> 'quantidade')::numeric * (e.value ->> 'preco_unitario')::numeric, 2)");
    expect(MIGRACAO).toContain("v_bruto := v_total;");
    expect(MIGRACAO).toContain("v_venda.tipo <> 'venda'");
    expect(MIGRACAO).toContain("IF v_ja_devolvido + (-v_total) > v_venda.total THEN");
  });

  it("a exclusão guarda motivo e itens na auditoria e não passa por cima de devolução", () => {
    expect(MIGRACAO).toContain("jsonb_build_object('motivo', v_motivo, 'itens', v_itens)");
    expect(MIGRACAO).toContain("exclua a devolução antes");
  });

  it("é registro: não grava em estoque, caixa, contas a pagar nem custo do material", () => {
    for (const tabela of ["material_lotes", "movimentacoes_estoque", "caixa_movimentos", "contas_pagar", "materiais", "material_custos"]) {
      expect(MIGRACAO, tabela).not.toMatch(new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+public\\.${tabela}\\b`, "i"));
    }
  });
});
