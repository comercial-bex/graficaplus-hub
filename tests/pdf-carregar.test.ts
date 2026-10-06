import { beforeEach, describe, expect, it, vi } from "vitest";
import { BancoFalso } from "./apoio/banco-falso-pdf";

/**
 * O que os carregadores do PDF pedem ao banco — contra um banco falso com as
 * regras do verdadeiro (views e GRANT por coluna, retrato de 05/10/2026).
 *
 * Os defeitos que isto pega já aconteceram: a via de produção pedindo
 * `custo_previsto` (que não existe em itens_os) e `custo_unitario` (sem grant em
 * orcamento_itens) e saindo com uma caixa de custo vazia; o PDF lendo prazo,
 * entrega e pagamento de views que não têm essas colunas e imprimindo "—"; e
 * consultas que falhavam em silêncio, deixando o documento pela metade.
 */

const banco = vi.hoisted(() => ({
  atual: null as unknown as { cliente: () => Record<string, unknown> },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy({}, { get: (_, prop) => banco.atual.cliente()[prop as string] }),
}));

import {
  carregarPropsFatura,
  carregarPropsOrcamento,
  carregarPropsOrcamento3d,
  carregarPropsOrcamentoComCustos,
  carregarPropsOS,
  carregarPropsReciboMaterial,
} from "../src/lib/pdf/generate";

const ORC = "orc-1059";
const OS = "os-214";

function semear(): BancoFalso {
  const b = new BancoFalso();
  const orcamento = {
    id: ORC,
    numero: 1059,
    cliente_id: "c1",
    vendedor_id: "u-vendedora",
    status: "aprovado",
    titulo: "Adesivos",
    validade_dias: 10,
    observacoes: null,
    observacao_cliente: null,
    observacao_interna: "Cliente busca às 17h.",
    contato_nome: "HARISSON",
    contato_telefone: null,
    contato_email: null,
    prazo: "2026-08-07",
    data_entrega_prometida: "2026-08-07",
    condicao_pagamento: { forma: "A Faturar", parcelas: 1 },
    precisa_entrega: false,
    precisa_instalacao: false,
    endereco_entrega: { descricao: "Endereço antigo, que não vale mais" },
    os_id: OS,
    created_at: "2026-08-04T18:40:00+00:00",
  };
  const preco = { valor_subtotal: 792.43, valor_total: 792.43, desconto_percentual: 0 };
  b.tabelas.orcamentos = [orcamento];
  b.tabelas.orcamentos_operacional = [{ ...orcamento, cliente_nome: "AGENCIA BEX MCP" }];
  b.tabelas.orcamentos_comercial = [{ ...orcamento, cliente_nome: "AGENCIA BEX MCP", ...preco }];
  b.tabelas.orcamentos_financeiro = [{ ...orcamento, cliente_nome: "AGENCIA BEX MCP", ...preco }];

  const itens = [
    {
      id: "i1",
      orcamento_id: ORC,
      descricao: "Adesivo starpac 1 ano RP400",
      quantidade: 3,
      unidade: "m2",
      ordem: 0,
      created_at: "2026-08-04T18:41:00+00:00",
      largura: 3,
      altura: 2.45,
      area_total: 22.05,
      acabamento: null,
      arquivo_id: null,
      tipo_produto: "Adesivo",
      especificacao: "Vinil branco brilho, laminação fosca",
      valor_unitario: 257.25,
      valor_total: 771.75,
      custo_unitario: 98.4,
    },
    {
      id: "i2",
      orcamento_id: ORC,
      descricao: "Adesivo starpac 1 ano RP400",
      quantidade: 1,
      unidade: "m2",
      ordem: 1,
      created_at: "2026-08-04T18:42:00+00:00",
      largura: 1.1,
      altura: 0.4,
      area_total: 0.44,
      acabamento: null,
      // item antigo: só arquivo_id, sem orcamento_item_arquivos
      arquivo_id: "a4",
      tipo_produto: null,
      especificacao: null,
      valor_unitario: 20.68,
      valor_total: 20.68,
      custo_unitario: 7.9,
    },
  ];
  const semPreco = itens.map(({ valor_unitario, valor_total, custo_unitario, ...resto }) => resto);
  b.tabelas.orcamento_itens_operacional = semPreco;
  b.tabelas.orcamento_itens_comercial = itens.map(({ custo_unitario, ...resto }) => resto);
  b.tabelas.orcamento_itens_financeiro = itens;
  b.tabelas.orcamento_item_arquivos = [
    { item_id: "i1", arquivo_id: "a2", capa: false, ordem: 1 },
    { item_id: "i1", arquivo_id: "a1", capa: true, ordem: 0 },
    { item_id: "i1", arquivo_id: "a3", capa: false, ordem: 2 },
  ];
  b.tabelas.arquivos = [
    { id: "a1", nome: "item1.png", caminho: "orcamento/orc-1059/1.png", bucket: null },
    { id: "a2", nome: "item1-b.png", caminho: "orcamento/orc-1059/2.png", bucket: null },
    { id: "a3", nome: "item1-c.png", caminho: "orcamento/orc-1059/3.png", bucket: null },
    { id: "a4", nome: "vitrine.webp", caminho: "orcamento/orc-1059/4.webp", bucket: null },
  ];
  // O Storage não assina esta: o item sai com "arte sem prévia", não some.
  b.semAssinatura.add("orcamento/orc-1059/4.webp");

  b.tabelas.clientes = [
    {
      id: "c1",
      nome: "AGENCIA BEX MCP",
      razao_social: null,
      cidade: "MACAPA",
      estado: "AP",
      telefone: "96991116169",
    },
  ];
  // A policy de `usuarios` só mostra o próprio registro: a vendedora não está
  // aqui, só na lista da equipe.
  b.tabelas.usuarios = [{ id: "u-teste", nome: "Quem está logado" }];
  b.rpcs.equipe_para_venda = () => [
    { id: "u-vendedora", nome: "FRANCYERICA SILVA ARAUJO", tem_comissao: false },
    { id: "u-estoque", nome: "Sergio Lima", tem_comissao: false },
  ];
  b.tabelas.empresa_config = [
    {
      id: true,
      nome: "BEX PRINT",
      razao_social: "Bex Print Gráfica e Comunicação Visual LTDA",
      cnpj: "68.726.406/0001-90",
      endereco: "Rua Cândido Mendes, 23",
      telefones: "(96) 99113-6169",
      cor_primaria: "#7B2E8B",
      logo_path: null,
      condicoes_gerais: null,
    },
  ];

  // OS nascida do orçamento
  const os = {
    id: OS,
    numero: 214,
    cliente_id: "c1",
    cliente_nome: "AGENCIA BEX MCP",
    vendedor_id: "u-vendedora",
    orcamento_id: ORC,
    status: "aguardando_producao",
    titulo: "Adesivos",
    briefing: null,
    observacoes: "Aplicar do lado esquerdo da porta.",
    prazo_entrega: "2026-08-07",
    data_entrega_real: null,
    created_at: "2026-08-05T12:00:00+00:00",
    precisa_entrega: true,
    precisa_instalacao: true,
  };
  b.tabelas.ordens_servico = [{ ...os, endereco_entrega: { descricao: "Av. FAB, 1200, Centro" } }];
  b.tabelas.ordens_servico_operacional = [os];
  b.tabelas.ordens_servico_comercial = [{ ...os, valor_total: 792.43 }];
  b.tabelas.ordens_servico_financeiro = [{ ...os, valor_total: 792.43 }];
  const itensOs = itens.map(({ orcamento_id, tipo_produto, especificacao, ...i }) => ({
    ...i,
    id: `os-${i.id}`,
    os_id: OS,
    arquivo_id: i.id === "i1" ? "a1" : null,
  }));
  b.tabelas.itens_os_operacional = itensOs.map(
    ({ valor_unitario, valor_total, custo_unitario, ...i }) => i,
  );
  b.tabelas.itens_os_comercial = itensOs.map(({ custo_unitario, ...i }) => i);
  b.tabelas.itens_os_financeiro = itensOs;
  b.rpcs.identificacao_legal_os = () =>
    "Impresso por CNPJ 68.726.406/0001-90 para AGENCIA BEX MCP (37.914.628/0001-02). Tiragem: 4 exemplares. Art. 38, Lei 9.504/1997.";
  // Duas peças com a MESMA descrição: cada item precisa do seu custo.
  b.rpcs.custo_real_por_peca = () => [
    {
      descricao: "Adesivo starpac 1 ano RP400",
      custo_real_total: 312.3,
      custo_real_unitario: 104.1,
      custo_perda: 12.3,
      margem_real: 0.5953,
    },
    {
      descricao: "Adesivo starpac 1 ano RP400",
      custo_real_total: 9.5,
      custo_real_unitario: 9.5,
      custo_perda: 0,
      margem_real: 0.5406,
    },
  ];
  b.tabelas.config_precificacao_3d = [
    {
      id: true,
      tarifa_kwh_padrao: 1.1339,
      mo_custo_hora_padrao: 40,
      mo_encargos_pct: 80,
      markup_padrao: 1.6,
      custo_admin_padrao: 0,
    },
  ];
  b.tabelas.custos_mao_de_obra = [
    { funcao: "Operador de plotter", custo_hora: 40, encargos_pct: 0.8, ativo: true },
  ];

  // financeiro
  b.tabelas.contas_receber = [{ id: "cr1", os_id: OS, valor_total: 792.43, status: "aberta" }];
  b.tabelas.parcelas_receber = [
    {
      id: "p2",
      conta_id: "cr1",
      parcela: 2,
      valor: 396.21,
      vencimento: "2026-09-06",
      status: "prevista",
    },
    {
      id: "p1",
      conta_id: "cr1",
      parcela: 1,
      valor: 396.22,
      vencimento: "2026-08-07",
      status: "paga",
    },
  ];
  b.tabelas.pagamentos = [{ id: "pg1", os_id: OS, valor: 396.22, status: "pago" }];
  b.tabelas.os_resultados_financeiros = [{ os_id: OS, status_financeiro: "parcial" }];

  // estoque
  b.tabelas.movimentacoes_estoque = [
    {
      id: "m1",
      os_id: OS,
      tipo: "saida",
      material_id: "mat1",
      quantidade: 24.2,
      unidade: "m2",
      usuario_id: "u-estoque",
      motivo: "Produção da OS 214",
      created_at: "2026-08-06T02:00:00+00:00",
    },
  ];
  b.tabelas.materiais = [{ id: "mat1", nome: "Vinil adesivo branco brilho", unidade: "m2" }];

  // 3D
  b.tabelas.orcamentos_3d = [
    {
      id: "3f9a1c22-0000-4000-8000-000000000000",
      titulo: "Chaveiro em PLA",
      descricao: "Azul royal",
      quantidade: 50,
      preco_comercial: 345,
      validade: "2026-10-09",
      prazo: "2026-10-10T15:00:00+00:00",
      status: "rascunho",
      created_at: "2026-10-02T12:00:00+00:00",
      created_by: "u-vendedora",
      cliente_id: "c1",
    },
  ];
  b.tabelas.orcamento_3d_calculos = [];
  return b;
}

let b: BancoFalso;
beforeEach(() => {
  b = semear();
  banco.atual = b as unknown as { cliente: () => Record<string, unknown> };
});

const nenhumaLeituraCom = (padrao: RegExp) =>
  b.leituras.filter((l) => padrao.test(l.colunas)).map((l) => `${l.relacao}: ${l.colunas}`);

describe("orçamento", () => {
  it("via do cliente: o combinado vem da tabela, o preço da view, nada pela metade", async () => {
    const p = await carregarPropsOrcamento(ORC, true, "comercial");

    expect(p.data_solicitacao).toBe("04/08/2026");
    expect(p.data_entrega).toBe("07/08/2026");
    expect(p.data_expedicao).toBe("07/08/2026");
    expect(p.data_validade).toBe("14/08/2026");
    expect(p.vendedor).toBe("FRANCYERICA SILVA ARAUJO");
    expect(p.total).toBe(792.43);
    expect(p.subtotal).toBe(792.43);
    expect(p.desconto).toBe(0);
    expect(p.pagamento).toEqual({ forma: "A Faturar", parcelas: 1 });
    expect(p.parcelas).toEqual([{ numero: 1, valor: 792.43, vencimento: null }]);
    // "retira" manda, mesmo com um endereço antigo guardado
    expect(p.entrega).toBe("Cliente retira na empresa");
    expect(p.observacoes).toBeNull();
    expect(p.observacao_interna).toBeNull();
    expect(p.cliente).toMatchObject({
      razao_social: "AGENCIA BEX MCP",
      contato: "HARISSON",
      telefone: "(96) 99111-6169",
    });

    expect(p.itens[0]).toMatchObject({
      tipo_produto: "Adesivo",
      especificacao: "Vinil branco brilho, laminação fosca",
      largura: 3,
      area_total: 22.05,
      layout_nome: "item1.png",
      layout_sem_previa: false,
      layouts_extras: 2,
      valor_unitario: 257.25,
    });
    expect(p.itens[0].layout_url).toContain("orcamento/orc-1059/1.png");
    // arte que o Storage não assinou: aparece como "sem prévia", com o nome
    expect(p.itens[1]).toMatchObject({
      layout_url: null,
      layout_sem_previa: true,
      layout_nome: "vitrine.webp",
    });

    // Nunca `*`, e o orçamento vem da TABELA com lista fechada.
    expect(nenhumaLeituraCom(/^\s*\*\s*$/)).toEqual([]);
    expect(b.leituras.find((l) => l.relacao === "orcamentos")?.colunas).toContain(
      "data_entrega_prometida",
    );
  });

  it("via de produção: só views operacionais, nenhuma coluna de dinheiro, nenhum custo", async () => {
    const p = await carregarPropsOrcamento(ORC, false);

    expect(p.mostrarValores).toBe(false);
    expect(p.total).toBe(0);
    expect(p.pagamento).toBeNull();
    expect(p.parcelas).toBeNull();
    expect(p.custos).toBeNull();
    expect(p.observacao_interna).toBe("Cliente busca às 17h.");
    expect(p.observacoes).toBeNull();
    expect(p.itens.every((i) => i.valor_unitario === 0 && i.valor_total === 0)).toBe(true);
    expect(p.itens[0].especificacao).toBe("Vinil branco brilho, laminação fosca");
    expect(p.data_entrega).toBe("07/08/2026");

    expect(b.leituras.filter((l) => /_(comercial|financeiro)$/.test(l.relacao))).toEqual([]);
    expect(nenhumaLeituraCom(/valor_|custo_|preco_|margem/)).toEqual([]);
    expect(b.leituras.some((l) => l.relacao === "custos_tabela")).toBe(false);
  });

  it("consulta que falha vira erro na tela — não um documento pela metade", async () => {
    b.falhas.add("orcamento_item_arquivos");
    await expect(carregarPropsOrcamento(ORC, true)).rejects.toThrow(/layouts dos itens/);

    b.falhas.clear();
    b.falhas.add("clientes");
    await expect(carregarPropsOrcamento(ORC, false)).rejects.toThrow(/cadastro do cliente/);

    b.falhas.clear();
    b.falhas.add("empresa_config");
    await expect(carregarPropsOrcamento(ORC, false)).rejects.toThrow(/dados da empresa/);
  });

  it("quem não vê preço recebe o motivo, não um PDF com R$ 0,00", async () => {
    // A view comercial filtra por can_see_prices: zero linhas.
    b.tabelas.orcamentos_comercial = [];
    await expect(carregarPropsOrcamento(ORC, true, "comercial")).rejects.toThrow(/não vê o preço/);
  });

  it("entrega com instalação e endereço; observação ao cliente no lugar das condições", async () => {
    Object.assign(b.tabelas.orcamentos[0], {
      precisa_entrega: true,
      precisa_instalacao: true,
      endereco_entrega: { descricao: "Av. FAB, 1200, Centro" },
      observacao_cliente: "Arte aprovada pelo WhatsApp em 03/08.",
      prazo: "2026-08-06",
      condicao_pagamento: {
        forma: "PIX",
        parcelas: 2,
        primeiro_vencimento: "2026-08-10",
        intervalo_dias: 15,
      },
    });
    const p = await carregarPropsOrcamento(ORC, true);
    expect(p.entrega).toBe("Av. FAB, 1200, Centro\nCom instalação");
    expect(p.observacoes).toBe("Arte aprovada pelo WhatsApp em 03/08.");
    // entrega prometida ao cliente x quando a produção fecha
    expect(p.data_entrega).toBe("07/08/2026");
    expect(p.data_expedicao).toBe("06/08/2026");
    expect(p.parcelas).toEqual([
      { numero: 1, valor: 396.22, vencimento: "2026-08-10" },
      { numero: 2, valor: 396.21, vencimento: "2026-08-25" },
    ]);
  });

  it("via interna: custo previsto da view financeira e o realizado casado peça a peça", async () => {
    const p = await carregarPropsOrcamentoComCustos(ORC);
    const itens = p.custos?.itens ?? [];
    expect(itens.map((i) => i.custo_previsto_unitario)).toEqual([98.4, 7.9]);
    // Mesma descrição nos dois: o 1º item leva a 1ª peça, o 2º a 2ª.
    expect(itens.map((i) => i.custo_real_unitario)).toEqual([104.1, 9.5]);
    expect(itens[0].custo_perda).toBe(12.3);
    expect(p.custos?.tarifas?.map((t) => t.rotulo)).toEqual(
      expect.arrayContaining(["Energia", "Mão de obra", "Markup", "Operador de plotter"]),
    );
    expect(nenhumaLeituraCom(/custo_previsto/)).toEqual([]);
  });
});

describe("OS, fatura, recibo e 3D", () => {
  it("OS via de produção: sem custo, com entrega da tabela e a identificação legal", async () => {
    const p = await carregarPropsOS(OS, false);
    expect(p.custos).toBeNull();
    expect(p.total).toBe(0);
    expect(p.status).toBe("Fila de produção");
    expect(p.entrega).toBe("Av. FAB, 1200, Centro\nCom instalação");
    expect(p.observacoes).toContain("Aplicar do lado esquerdo da porta.");
    expect(p.observacoes).toContain("Lei 9.504/1997");
    expect(p.itens[0].layout_url).toContain("orcamento/orc-1059/1.png");
    expect(nenhumaLeituraCom(/valor_|custo_/)).toEqual([]);
  });

  it("OS via do cliente: valores do nível comercial, desconto derivado dos itens", async () => {
    b.tabelas.ordens_servico_comercial[0].valor_total = 750;
    const p = await carregarPropsOS(OS, true);
    expect(p.total).toBe(750);
    expect(p.subtotal).toBe(792.43);
    expect(p.desconto).toBe(42.43);
  });

  it("identificação legal que falha derruba a OS (é exigência da lei, não enfeite)", async () => {
    b.falhas.add("rpc:identificacao_legal_os");
    await expect(carregarPropsOS(OS, false)).rejects.toThrow(/identificação legal/);
  });

  it("fatura: parcelas reais com a paga marcada, saldo e a forma do orçamento", async () => {
    const p = await carregarPropsFatura(OS);
    expect(p.parcelas).toEqual([
      { numero: 1, valor: 396.22, vencimento: "2026-08-07", pago: true },
      { numero: 2, valor: 396.21, vencimento: "2026-09-06", pago: false },
    ]);
    expect(p.valor_pago).toBe(396.22);
    expect(p.pagamento).toEqual({ forma: "A Faturar", parcelas: 2 });
    expect(p.status).toBe("Parcial");
    expect(p.observacoes?.startsWith("Impresso por CNPJ")).toBe(true);
  });

  it("recibo: quem retirou aparece mesmo sem acesso ao cadastro de usuários", async () => {
    const p = await carregarPropsReciboMaterial(OS);
    expect(p.assinaturas?.direita).toBe("Retirado por Sergio Lima");
    expect(p.itens[0]).toMatchObject({
      descricao: "Vinil adesivo branco brilho",
      quantidade: 24.2,
      acabamento: "Produção da OS 214",
    });
    // 02h UTC do dia 06 ainda é dia 05 em Macapá
    expect(p.data_solicitacao).toBe("05/08/2026");
    expect(nenhumaLeituraCom(/custo/)).toEqual([]);
  });

  it("orçamento 3D: validade (coluna date) não volta um dia e o prazo vira a entrega", async () => {
    const p = await carregarPropsOrcamento3d("3f9a1c22-0000-4000-8000-000000000000");
    expect(p.numero).toBe("3F9A1C22");
    expect(p.data_validade).toBe("09/10/2026");
    expect(p.data_entrega).toBe("10/10/2026");
    expect(p.vendedor).toBe("FRANCYERICA SILVA ARAUJO");
    expect(p.itens[0]).toMatchObject({ quantidade: 50, valor_unitario: 6.9, valor_total: 345 });
  });
});
